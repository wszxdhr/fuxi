import fs from 'fs-extra';
import path from 'node:path';
import { buildPrompt, formatIterationRecord, runAi } from './ai';
import { createPr, listFailedRuns, viewPr } from './gh';
import { Logger } from './logger';
import { commitAll, ensureWorktree, getCurrentBranch, getRepoRoot, pushBranch } from './git';
import { LoopConfig, TestRunResult, WorkflowFiles } from './types';
import { appendSection, ensureFile, isoNow, readFileSafe, runCommand } from './utils';

async function ensureWorkflowFiles(workflowFiles: WorkflowFiles): Promise<void> {
  await ensureFile(workflowFiles.workflowDoc, '# AI 工作流程基线\n');
  await ensureFile(workflowFiles.planFile, '# 计划\n');
  await ensureFile(workflowFiles.notesFile, '# 持久化记忆\n');
}

const MAX_TEST_LOG_LENGTH = 4000;

function trimOutput(output: string, limit = MAX_TEST_LOG_LENGTH): string {
  if (!output) return '';
  if (output.length <= limit) return output;
  return `${output.slice(0, limit)}\n……（输出已截断，原始长度 ${output.length} 字符）`;
}

async function runSingleTest(kind: 'unit' | 'e2e', command: string, cwd: string, logger: Logger): Promise<TestRunResult> {
  const label = kind === 'unit' ? '单元测试' : 'e2e 测试';
  logger.info(`执行${label}: ${command}`);
  const result = await runCommand('bash', ['-lc', command], {
    cwd,
    logger,
    verboseLabel: 'shell',
    verboseCommand: `bash -lc "${command}"`
  });
  const success = result.exitCode === 0;
  if (success) {
    logger.success(`${label}完成`);
  } else {
    logger.warn(`${label}失败（退出码 ${result.exitCode}）`);
  }

  return {
    kind,
    command,
    success,
    exitCode: result.exitCode,
    stdout: trimOutput(result.stdout.trim()),
    stderr: trimOutput(result.stderr.trim())
  };
}

async function runTests(config: LoopConfig, workDir: string, logger: Logger): Promise<TestRunResult[]> {
  const results: TestRunResult[] = [];

  if (config.runTests && config.tests.unitCommand) {
    const unitResult = await runSingleTest('unit', config.tests.unitCommand, workDir, logger);
    results.push(unitResult);
  }

  if (config.runE2e && config.tests.e2eCommand) {
    const e2eResult = await runSingleTest('e2e', config.tests.e2eCommand, workDir, logger);
    results.push(e2eResult);
  }

  return results;
}

function reRootPath(filePath: string, repoRoot: string, workDir: string): string {
  const relative = path.relative(repoRoot, filePath);
  if (relative.startsWith('..')) return filePath;
  return path.join(workDir, relative);
}

function reRootWorkflowFiles(workflowFiles: WorkflowFiles, repoRoot: string, workDir: string): WorkflowFiles {
  if (repoRoot === workDir) return workflowFiles;
  return {
    workflowDoc: reRootPath(workflowFiles.workflowDoc, repoRoot, workDir),
    notesFile: reRootPath(workflowFiles.notesFile, repoRoot, workDir),
    planFile: reRootPath(workflowFiles.planFile, repoRoot, workDir)
  };
}

function buildBodyFile(workDir: string): string {
  const output = path.join(workDir, 'memory', 'pr-body.md');
  return output;
}

async function writePrBody(bodyPath: string, notes: string, plan: string): Promise<void> {
  const lines = [
    '# 变更摘要',
    plan,
    '\n# 关键输出',
    notes
  ];
  await fs.mkdirp(path.dirname(bodyPath));
  await fs.writeFile(bodyPath, lines.join('\n\n'), 'utf8');
}

export async function runLoop(config: LoopConfig): Promise<void> {
  const logger = new Logger({ verbose: config.verbose });
  const repoRoot = await getRepoRoot(config.cwd, logger);
  logger.debug(`仓库根目录: ${repoRoot}`);

  const workDir = config.git.useWorktree
    ? await ensureWorktree(config.git, repoRoot, logger)
    : repoRoot;
  logger.debug(`工作目录: ${workDir}`);

  const workflowFiles = reRootWorkflowFiles(config.workflowFiles, repoRoot, workDir);
  await ensureWorkflowFiles(workflowFiles);

  const planContent = await readFileSafe(workflowFiles.planFile);
  if (planContent.trim().length === 0) {
    logger.warn('plan 文件为空，建议 AI 首轮生成计划');
  }

  let branchName = config.git.branchName;
  if (!branchName) {
    branchName = await getCurrentBranch(workDir, logger);
  }

  for (let i = 1; i <= config.iterations; i += 1) {
    const workflowGuide = await readFileSafe(workflowFiles.workflowDoc);
    const plan = await readFileSafe(workflowFiles.planFile);
    const notes = await readFileSafe(workflowFiles.notesFile);
    logger.debug(`加载提示上下文，长度：workflow=${workflowGuide.length}, plan=${plan.length}, notes=${notes.length}`);

    const prompt = buildPrompt({
      task: config.task,
      workflowGuide,
      plan,
      notes,
      iteration: i
    });
    logger.debug(`第 ${i} 轮提示长度: ${prompt.length}`);

    logger.info(`第 ${i} 轮提示构建完成，调用 AI CLI...`);
    const aiOutput = await runAi(prompt, config.ai, logger, workDir);

    const hitStop = aiOutput.includes(config.stopSignal);
    let testResults: TestRunResult[] = [];
    try {
      testResults = await runTests(config, workDir, logger);
    } catch (error) {
      const errorMessage = String(error);
      logger.warn(`测试执行异常: ${errorMessage}`);
      testResults = [{
        kind: 'unit',
        command: config.tests.unitCommand ?? '未知测试命令',
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: trimOutput(errorMessage)
      }];
    }

    const record = formatIterationRecord({
      iteration: i,
      prompt,
      aiOutput,
      timestamp: isoNow(),
      testResults
    });

    await appendSection(workflowFiles.notesFile, record);
    logger.success(`已将第 ${i} 轮输出写入 ${workflowFiles.notesFile}`);

    if (hitStop) {
      logger.info(`检测到停止标记 ${config.stopSignal}，提前结束循环`);
      break;
    }
  }

  if (config.autoCommit) {
    await commitAll('chore: fuxi 自动迭代提交', workDir, logger).catch(error => {
      logger.warn(String(error));
    });
  }

  if (config.autoPush && branchName) {
    await pushBranch(branchName, workDir, logger).catch(error => {
      logger.warn(String(error));
    });
  }

  if (config.pr.enable && branchName) {
    const bodyFile = config.pr.bodyPath ?? buildBodyFile(workDir);
    const notes = await readFileSafe(workflowFiles.notesFile);
    const plan = await readFileSafe(workflowFiles.planFile);
    await writePrBody(bodyFile, notes, plan);

    const prInfo = await createPr(branchName, { ...config.pr, bodyPath: bodyFile }, workDir, logger);
    if (prInfo) {
      logger.success(`PR 已创建: ${prInfo.url}`);
      const failedRuns = await listFailedRuns(branchName, workDir, logger);
      if (failedRuns.length > 0) {
        failedRuns.forEach(run => {
          logger.warn(`Actions 失败: ${run.name} (${run.status}/${run.conclusion ?? 'unknown'}) ${run.url}`);
        });
      }
    }
  } else if (branchName) {
    const prInfo = await viewPr(branchName, workDir, logger);
    if (prInfo) {
      logger.info(`已有 PR: ${prInfo.url}`);
    }
  }

  logger.success('fuxi 迭代流程结束');
}
