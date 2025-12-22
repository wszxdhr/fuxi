import fs from 'fs-extra';
import path from 'node:path';
import { buildPrompt, formatIterationRecord, runAi } from './ai';
import { createPr, listFailedRuns, viewPr } from './gh';
import { Logger } from './logger';
import { commitAll, ensureWorktree, getCurrentBranch, getRepoRoot, pushBranch } from './git';
import { LoopConfig } from './types';
import { appendSection, ensureFile, isoNow, readFileSafe, resolvePath, runCommand } from './utils';

async function ensureWorkflowFiles(config: LoopConfig): Promise<void> {
  await ensureFile(config.workflowFiles.workflowDoc, '# AI 工作流程基线\n');
  await ensureFile(config.workflowFiles.planFile, '# 计划\n');
  await ensureFile(config.workflowFiles.notesFile, '# 持久化记忆\n');
}

async function runShell(command: string, cwd: string): Promise<void> {
  const result = await runCommand('bash', ['-lc', command], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

async function runTests(config: LoopConfig, workDir: string, logger: Logger): Promise<void> {
  if (config.runTests && config.tests.unitCommand) {
    logger.info(`执行单元测试: ${config.tests.unitCommand}`);
    await runShell(config.tests.unitCommand, workDir);
    logger.success('单元测试完成');
  }
  if (config.runE2e && config.tests.e2eCommand) {
    logger.info(`执行 e2e 测试: ${config.tests.e2eCommand}`);
    await runShell(config.tests.e2eCommand, workDir);
    logger.success('e2e 测试完成');
  }
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
  const repoRoot = await getRepoRoot(config.cwd);
  await ensureWorkflowFiles(config);

  const workDir = config.git.useWorktree
    ? await ensureWorktree(config.git, repoRoot, logger)
    : repoRoot;

  const planContent = await readFileSafe(config.workflowFiles.planFile);
  if (planContent.trim().length === 0) {
    logger.warn('plan 文件为空，建议 AI 首轮生成计划');
  }

  let branchName = config.git.branchName;
  if (!branchName) {
    branchName = await getCurrentBranch(workDir);
  }

  for (let i = 1; i <= config.iterations; i += 1) {
    const workflowGuide = await readFileSafe(config.workflowFiles.workflowDoc);
    const plan = await readFileSafe(config.workflowFiles.planFile);
    const notes = await readFileSafe(config.workflowFiles.notesFile);

    const prompt = buildPrompt({
      task: config.task,
      workflowGuide,
      plan,
      notes,
      iteration: i
    });

    logger.info(`第 ${i} 轮提示构建完成，调用 AI CLI...`);
    const aiOutput = await runAi(prompt, config.ai, logger, workDir);

    const record = formatIterationRecord({
      iteration: i,
      prompt,
      aiOutput,
      timestamp: isoNow()
    });

    await appendSection(config.workflowFiles.notesFile, record);
    logger.success(`已将第 ${i} 轮输出写入 ${config.workflowFiles.notesFile}`);

    const hitStop = aiOutput.includes(config.stopSignal);
    await runTests(config, workDir, logger).catch(error => {
      logger.warn(`测试执行失败: ${String(error)}`);
    });

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
    const notes = await readFileSafe(config.workflowFiles.notesFile);
    const plan = await readFileSafe(config.workflowFiles.planFile);
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
