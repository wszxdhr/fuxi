import fs from 'fs-extra';
import path from 'node:path';
import { buildPrompt, formatIterationRecord, mergeTokenUsage, runAi } from './ai';
import { ensureDependencies } from './deps';
import { GhPrInfo, createPr, listFailedRuns, viewPr } from './gh';
import { Logger } from './logger';
import { commitAll, ensureWorktree, getCurrentBranch, getRepoRoot, isBranchPushed, isWorktreeClean, pushBranch, removeWorktree } from './git';
import { formatCommandLine } from './logs';
import { createRunTracker } from './runtime-tracker';
import { buildFallbackSummary, buildSummaryPrompt, ensurePrBodySections, parseDeliverySummary } from './summary';
import { CommitMessage, DeliverySummary, LoopConfig, TestRunResult, TokenUsage, WorkflowFiles, WorktreeResult } from './types';
import { appendSection, ensureFile, isoNow, readFileSafe, runCommand } from './utils';
import { buildWebhookPayload, sendWebhookNotifications } from './webhook';

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

async function safeCommandOutput(command: string, args: string[], cwd: string, logger: Logger, label: string, verboseCommand: string): Promise<string> {
  const result = await runCommand(command, args, {
    cwd,
    logger,
    verboseLabel: label,
    verboseCommand
  });
  if (result.exitCode !== 0) {
    logger.warn(`${label} 命令失败: ${result.stderr || result.stdout}`);
    return '';
  }
  return result.stdout.trim();
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
  return path.join(workDir, 'memory', 'pr-body.md');
}

async function writePrBody(bodyPath: string, content: string, appendExisting: boolean): Promise<void> {
  await fs.mkdirp(path.dirname(bodyPath));
  let finalContent = content.trim();
  if (appendExisting) {
    const existing = await readFileSafe(bodyPath);
    const trimmedExisting = existing.trim();
    if (trimmedExisting.length > 0) {
      finalContent = `${trimmedExisting}\n\n---\n\n${finalContent}`;
    }
  }
  await fs.writeFile(bodyPath, `${finalContent}\n`, 'utf8');
}

interface WorktreeCleanupContext {
  readonly repoRoot: string;
  readonly workDir: string;
  readonly branchName?: string;
  readonly prInfo: GhPrInfo | null;
  readonly worktreeCreated: boolean;
  readonly logger: Logger;
}

async function cleanupWorktreeIfSafe(context: WorktreeCleanupContext): Promise<void> {
  const { repoRoot, workDir, branchName, prInfo, worktreeCreated, logger } = context;
  if (!worktreeCreated) {
    logger.debug('worktree 并非本次创建，跳过自动清理');
    return;
  }
  if (workDir === repoRoot) {
    logger.debug('当前未使用独立 worktree，跳过自动清理');
    return;
  }
  if (!branchName) {
    logger.warn('未能确定 worktree 分支名，保留工作目录以免丢失进度');
    return;
  }

  const clean = await isWorktreeClean(workDir, logger);
  if (!clean) {
    logger.warn('worktree 仍有未提交变更，已保留工作目录');
    return;
  }

  const pushed = await isBranchPushed(branchName, workDir, logger);
  if (!pushed) {
    logger.warn(`分支 ${branchName} 尚未推送到远端，已保留 worktree`);
    return;
  }

  if (!prInfo) {
    logger.warn('未检测到关联 PR，已保留 worktree');
    return;
  }

  await removeWorktree(workDir, repoRoot, logger);
}

/**
 * 执行主迭代循环。
 */
export async function runLoop(config: LoopConfig): Promise<void> {
  const logger = new Logger({ verbose: config.verbose, logFile: config.logFile });
  const repoRoot = await getRepoRoot(config.cwd, logger);
  logger.debug(`仓库根目录: ${repoRoot}`);

  const worktreeResult: WorktreeResult = config.git.useWorktree
    ? await ensureWorktree(config.git, repoRoot, logger)
    : { path: repoRoot, created: false };
  const workDir = worktreeResult.path;
  const worktreeCreated = worktreeResult.created;
  logger.debug(`工作目录: ${workDir}`);

  const commandLine = formatCommandLine(process.argv);
  const runTracker = await createRunTracker({
    logFile: config.logFile,
    command: commandLine,
    path: workDir,
    logger
  });

  let branchName = config.git.branchName;
  let lastRound = 0;
  let runError: string | null = null;

  const notifyWebhook = async (event: 'task_start' | 'iteration_start' | 'task_end', iteration: number, stage: string): Promise<void> => {
    const payload = buildWebhookPayload({
      event,
      task: config.task,
      branch: branchName,
      iteration,
      stage
    });
    await sendWebhookNotifications(config.webhooks, payload, logger);
  };

  try {
    if (!branchName) {
      try {
        branchName = await getCurrentBranch(workDir, logger);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`读取分支名失败，webhook 中将缺失分支信息：${message}`);
      }
    }

    await notifyWebhook('task_start', 0, '任务开始');

    if (config.skipInstall) {
      logger.info('已跳过依赖检查');
    } else {
      await ensureDependencies(workDir, logger);
    }

    const workflowFiles = reRootWorkflowFiles(config.workflowFiles, repoRoot, workDir);
    await ensureWorkflowFiles(workflowFiles);

    const planContent = await readFileSafe(workflowFiles.planFile);
    if (planContent.trim().length === 0) {
      logger.warn('plan 文件为空，建议 AI 首轮生成计划');
    }

    const aiConfig = config.ai;

    let accumulatedUsage: TokenUsage | null = null;
    let lastTestResults: TestRunResult[] | null = null;
    let lastAiOutput = '';
    let prInfo: GhPrInfo | null = null;
    let prFailed = false;

    for (let i = 1; i <= config.iterations; i += 1) {
      await notifyWebhook('iteration_start', i, `开始第 ${i} 轮迭代`);

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
      const aiResult = await runAi(prompt, aiConfig, logger, workDir);
      accumulatedUsage = mergeTokenUsage(accumulatedUsage, aiResult.usage);
      lastAiOutput = aiResult.output;

      const hitStop = aiResult.output.includes(config.stopSignal);
      let testResults: TestRunResult[] = [];
      const shouldRunTests = config.runTests || config.runE2e;
      if (shouldRunTests) {
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
      }

      const record = formatIterationRecord({
        iteration: i,
        prompt,
        aiOutput: aiResult.output,
        timestamp: isoNow(),
        testResults
      });

      await appendSection(workflowFiles.notesFile, record);
      logger.success(`已将第 ${i} 轮输出写入 ${workflowFiles.notesFile}`);

      lastTestResults = testResults;
      lastRound = i;
      await runTracker?.update(i, accumulatedUsage?.totalTokens ?? 0);

      const hasTestFailure = testResults.some(result => !result.success);

      if (hitStop && !hasTestFailure) {
        logger.info(`检测到停止标记 ${config.stopSignal}，提前结束循环`);
        break;
      }
      if (hitStop && hasTestFailure) {
        logger.info(`检测到停止标记 ${config.stopSignal}，但测试失败，继续进入下一轮修复`);
      }
    }

    const lastTestFailed = lastTestResults?.some(result => !result.success) ?? false;

    if (lastTestFailed) {
      logger.warn('存在未通过的测试，已跳过自动提交/推送/PR');
    }

    let deliverySummary: DeliverySummary | null = null;
    const shouldPrepareDelivery = !lastTestFailed && (config.autoCommit || config.pr.enable);
    if (shouldPrepareDelivery) {
      const [gitStatus, diffStat] = await Promise.all([
        safeCommandOutput('git', ['status', '--short'], workDir, logger, 'git', 'git status --short'),
        safeCommandOutput('git', ['diff', '--stat'], workDir, logger, 'git', 'git diff --stat')
      ]);
      const summaryPrompt = buildSummaryPrompt({
        task: config.task,
        plan: await readFileSafe(workflowFiles.planFile),
        notes: await readFileSafe(workflowFiles.notesFile),
        lastAiOutput,
        testResults: lastTestResults,
        gitStatus,
        diffStat,
        branchName
      });
      try {
        const summaryResult = await runAi(summaryPrompt, aiConfig, logger, workDir);
        accumulatedUsage = mergeTokenUsage(accumulatedUsage, summaryResult.usage);
        deliverySummary = parseDeliverySummary(summaryResult.output);
        if (!deliverySummary) {
          logger.warn('AI 总结输出解析失败，使用兜底文案');
        }
      } catch (error) {
        logger.warn(`AI 总结生成失败: ${String(error)}`);
      }
      if (!deliverySummary) {
        deliverySummary = buildFallbackSummary({ task: config.task, testResults: lastTestResults });
      }
    }
    await runTracker?.update(lastRound, accumulatedUsage?.totalTokens ?? 0);

    if (config.autoCommit && !lastTestFailed) {
      const summary = deliverySummary ?? buildFallbackSummary({ task: config.task, testResults: lastTestResults });
      const commitMessage: CommitMessage = {
        title: summary.commitTitle,
        body: summary.commitBody
      };
      await commitAll(commitMessage, workDir, logger).catch(error => {
        logger.warn(String(error));
      });
    }

    if (config.autoPush && branchName && !lastTestFailed) {
      await pushBranch(branchName, workDir, logger).catch(error => {
        logger.warn(String(error));
      });
    }

    if (config.pr.enable && branchName && !lastTestFailed) {
      logger.info('开始创建 PR...');
      const summary = deliverySummary ?? buildFallbackSummary({ task: config.task, testResults: lastTestResults });
      const prTitleCandidate = config.pr.title?.trim() || summary.prTitle;
      const prBodyContent = ensurePrBodySections(summary.prBody, {
        commitTitle: summary.commitTitle,
        commitBody: summary.commitBody,
        testResults: lastTestResults
      });
      const bodyFile = config.pr.bodyPath ?? buildBodyFile(workDir);
      await writePrBody(bodyFile, prBodyContent, Boolean(config.pr.bodyPath));

      const createdPr = await createPr(branchName, { ...config.pr, title: prTitleCandidate, bodyPath: bodyFile }, workDir, logger);
      prInfo = createdPr;
      if (createdPr) {
        logger.success(`PR 已创建: ${createdPr.url}`);
        const failedRuns = await listFailedRuns(branchName, workDir, logger);
        if (failedRuns.length > 0) {
          failedRuns.forEach(run => {
            logger.warn(`Actions 失败: ${run.name} (${run.status}/${run.conclusion ?? 'unknown'}) ${run.url}`);
          });
        }
      } else {
        prFailed = true;
        logger.error('PR 创建失败，详见上方 gh 输出');
      }
    } else if (branchName && !config.pr.enable) {
      logger.info('未开启 PR 创建（--pr 未传），尝试查看已有 PR');
      const existingPr = await viewPr(branchName, workDir, logger);
      prInfo = existingPr;
      if (existingPr) logger.info(`已有 PR: ${existingPr.url}`);
    }

    if (accumulatedUsage) {
      const input = accumulatedUsage.inputTokens ?? '-';
      const output = accumulatedUsage.outputTokens ?? '-';
      logger.info(`Token 消耗汇总：输入 ${input}｜输出 ${output}｜总计 ${accumulatedUsage.totalTokens}`);
    } else {
      logger.info('未解析到 Token 消耗信息，可检查 AI CLI 输出格式是否包含 token 提示');
    }

    if (lastTestFailed || prFailed) {
      throw new Error('流程存在未解决的问题（测试未通过或 PR 创建失败）');
    }

    if (config.git.useWorktree && workDir !== repoRoot) {
      await cleanupWorktreeIfSafe({
        repoRoot,
        workDir,
        branchName,
        prInfo,
        worktreeCreated,
        logger
      });
    }

    logger.success(`fuxi 迭代流程结束｜Token 总计 ${accumulatedUsage?.totalTokens ?? '未知'}`);
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const stage = runError ? '任务结束（失败）' : '任务结束';
    await notifyWebhook('task_end', lastRound, stage);
    await runTracker?.finalize();
  }
}
