import fs from 'fs-extra';
import path from 'node:path';
import {
  buildBranchNamePrompt,
  buildDocsPrompt,
  buildFixPrompt,
  buildPlanItemPrompt,
  buildPlanningPrompt,
  buildQualityPrompt,
  buildTestPrompt,
  formatIterationRecord,
  mergeTokenUsage,
  parseBranchName,
  runAi
} from './ai';
import { ensureDependencies } from './deps';
import { GhPrInfo, createPr, enableAutoMerge, listFailedRuns, viewPr } from './gh';
import { Logger } from './logger';
import { commitAll, ensureWorktree, generateBranchNameFromTask, getCurrentBranch, getRepoRoot, isBranchPushed, isWorktreeClean, pushBranch, removeWorktree } from './git';
import { formatCommandLine } from './logs';
import { getPendingPlanItems } from './plan';
import { detectQualityCommands } from './quality';
import { createRunTracker } from './runtime-tracker';
import { buildFallbackSummary, buildSummaryPrompt, ensurePrBodySections, parseDeliverySummary } from './summary';
import { CheckRunResult, CommitMessage, DeliverySummary, LoopConfig, LoopResult, TestRunResult, TokenUsage, WorkflowFiles, WorktreeResult } from './types';
import { appendSection, ensureFile, isoNow, readFileSafe, runCommand } from './utils';
import { WebhookPayload, buildWebhookPayload, sendWebhookNotifications } from './webhook';
import { normalizeText, trimOutput, truncateText } from './lib/text-utils';
import { LOG_LIMITS, QUALITY_SKIP_KEYWORDS, TEST_KEYWORDS } from './lib/constants';

async function ensureWorkflowFiles(workflowFiles: WorkflowFiles): Promise<void> {
  await ensureFile(workflowFiles.workflowDoc, '# AI 工作流程基线\n');
  await ensureFile(workflowFiles.planFile, '# 计划\n');
  await ensureFile(workflowFiles.notesFile, '# 持久化记忆\n');
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

function normalizeWebhookUrl(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

function normalizeRepoUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  const withoutGit = trimmed.replace(/\.git$/i, '');
  if (withoutGit.includes('://')) {
    try {
      const parsed = new URL(withoutGit);
      const protocol = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.protocol : 'https:';
      const pathname = parsed.pathname.replace(/\.git$/i, '');
      return `${protocol}//${parsed.host}${pathname}`.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  const scpMatch = withoutGit.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (!scpMatch) return null;
  const host = scpMatch[1];
  const repoPath = scpMatch[2];
  return `https://${host}/${repoPath}`.replace(/\/+$/, '');
}

async function resolveCommitLink(cwd: string, logger: Logger): Promise<string> {
  const sha = await safeCommandOutput('git', ['rev-parse', 'HEAD'], cwd, logger, 'git', 'git rev-parse HEAD');
  if (!sha) return '';
  const remote = await safeCommandOutput('git', ['remote', 'get-url', 'origin'], cwd, logger, 'git', 'git remote get-url origin');
  if (!remote) return '';
  const repoUrl = normalizeRepoUrl(remote);
  if (!repoUrl) return '';
  return `${repoUrl}/commit/${sha}`;
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

async function runQualityChecks(commands: { name: string; command: string }[], cwd: string, logger: Logger): Promise<CheckRunResult[]> {
  const results: CheckRunResult[] = [];
  for (const item of commands) {
    logger.info(`执行质量检查: ${item.command}`);
    const result = await runCommand('bash', ['-lc', item.command], {
      cwd,
      logger,
      verboseLabel: 'shell',
      verboseCommand: `bash -lc "${item.command}"`
    });
    results.push({
      name: item.name,
      command: item.command,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: trimOutput(result.stdout.trim()),
      stderr: trimOutput(result.stderr.trim())
    });
  }
  return results;
}

function buildCheckResultSummary(results: CheckRunResult[]): string {
  if (results.length === 0) return '（未执行质量检查）';
  return results
    .map(result => {
      const status = result.success ? '通过' : `失败（退出码 ${result.exitCode}）`;
      const output = result.success ? '' : `\n${result.stderr || result.stdout || '（无输出）'}`;
      return `- ${result.name}: ${status}｜命令: ${result.command}${output}`;
    })
    .join('\n');
}

function buildFailedCheckSummary(results: CheckRunResult[]): string {
  return buildCheckResultSummary(results.filter(result => !result.success));
}

function buildTestResultSummary(results: TestRunResult[]): string {
  if (results.length === 0) return '（未执行测试）';
  return results
    .map(result => {
      const label = result.kind === 'unit' ? '单元测试' : 'e2e 测试';
      const status = result.success ? '通过' : `失败（退出码 ${result.exitCode}）`;
      const output = result.success ? '' : `\n${result.stderr || result.stdout || '（无输出）'}`;
      return `- ${label}: ${status}｜命令: ${result.command}${output}`;
    })
    .join('\n');
}

function buildFailedTestSummary(results: TestRunResult[]): string {
  return buildTestResultSummary(results.filter(result => !result.success));
}

function formatSystemRecord(stage: string, detail: string, timestamp: string): string {
  return [
    `### 记录 ｜ ${timestamp} ｜ ${stage}`,
    '',
    detail,
    ''
  ].join('\n');
}

/**
 * 判断是否应跳过代码质量检查。
 */
function shouldSkipQuality(content: string, cliSkip: boolean): boolean {
  if (cliSkip) return true;
  const normalized = content.replace(/\s+/g, '');
  if (!normalized) return false;
  return QUALITY_SKIP_KEYWORDS.some(keyword => normalized.includes(keyword));
}

/**
 * 判断计划内容是否包含测试相关事项。
 */
function hasTestKeywords(content: string): boolean {
  return TEST_KEYWORDS.some(keyword => new RegExp(keyword, 'i').test(content));
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

async function runTestsSafely(config: LoopConfig, workDir: string, logger: Logger): Promise<TestRunResult[]> {
  try {
    return await runTests(config, workDir, logger);
  } catch (error) {
    const errorMessage = String(error);
    logger.warn(`测试执行异常: ${errorMessage}`);
    return [{
      kind: 'unit',
      command: config.tests.unitCommand ?? '未知测试命令',
      success: false,
      exitCode: -1,
      stdout: '',
      stderr: trimOutput(errorMessage)
    }];
  }
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
export async function runLoop(config: LoopConfig): Promise<LoopResult> {
  const logger = new Logger({ verbose: config.verbose, logFile: config.logFile });
  const repoRoot = await getRepoRoot(config.cwd, logger);
  logger.debug(`仓库根目录: ${repoRoot}`);
  // 项目名以首次识别为准，避免切换 worktree 后发生变化。
  const initialProjectName = path.basename(repoRoot);

  let branchName = config.git.branchName;
  let workDir = repoRoot;
  let worktreeCreated = false;

  const commandLine = formatCommandLine(process.argv);
  let runTracker: Awaited<ReturnType<typeof createRunTracker>> | null = null;

  let accumulatedUsage: TokenUsage | null = null;
  let lastTestResults: TestRunResult[] | null = null;
  let lastAiOutput = '';
  let lastRound = 0;
  let runError: string | null = null;
  let prInfo: GhPrInfo | null = null;
  let prFailed = false;
  let sessionIndex = 0;
  let commitLink = '';
  let prLink = '';
  let commitCreated = false;
  let pushSucceeded = false;

  const preWorktreeRecords: string[] = [];
  const resolveProjectName = (): string => initialProjectName;

  const notifyWebhook = async (
    event: 'task_start' | 'iteration_start' | 'task_end',
    iteration: number,
    stage: string,
    plan?: string
  ): Promise<void> => {
    const project = resolveProjectName();
    const payload = event === 'task_start'
      ? buildWebhookPayload({
          event,
          task: config.task,
          branch: branchName,
          iteration,
          stage,
          project,
          commit: commitLink,
          pr: prLink,
          plan
        })
      : buildWebhookPayload({
          event,
          branch: branchName,
          iteration,
          stage,
          project,
          commit: commitLink,
          pr: prLink,
          plan
        });
    await sendWebhookNotifications(config.webhooks, payload, logger);
  };

  try {
    await notifyWebhook('task_start', 0, '任务开始');

    if (config.git.useWorktree && !branchName) {
      const branchPrompt = buildBranchNamePrompt({ task: config.task });
      await notifyWebhook('iteration_start', sessionIndex + 1, '分支名生成');
      logger.info('分支名生成提示构建完成，调用 AI CLI...');
      const aiResult = await runAi(branchPrompt, config.ai, logger, repoRoot);
      accumulatedUsage = mergeTokenUsage(accumulatedUsage, aiResult.usage);
      lastAiOutput = aiResult.output;
      sessionIndex += 1;
      lastRound = sessionIndex;

      const record = formatIterationRecord({
        iteration: sessionIndex,
        stage: '分支名生成',
        prompt: branchPrompt,
        aiOutput: aiResult.output,
        timestamp: isoNow()
      });
      preWorktreeRecords.push(record);

      const parsed = parseBranchName(aiResult.output);
      if (parsed) {
        branchName = parsed;
        logger.info(`AI 生成分支名：${branchName}`);
      } else {
        branchName = generateBranchNameFromTask(config.task);
        logger.warn(`未解析到 AI 分支名，使用兜底分支：${branchName}`);
      }
    }

    const worktreeResult: WorktreeResult = config.git.useWorktree
      ? await ensureWorktree({ ...config.git, branchName }, repoRoot, logger)
      : { path: repoRoot, created: false };
    workDir = worktreeResult.path;
    worktreeCreated = worktreeResult.created;
    logger.debug(`工作目录: ${workDir}`);

    runTracker = await createRunTracker({
      logFile: config.logFile,
      command: commandLine,
      path: workDir,
      logger
    });

    if (runTracker && sessionIndex > 0) {
      await runTracker.update(sessionIndex, accumulatedUsage?.totalTokens ?? 0);
    }

    if (config.skipInstall) {
      logger.info('已跳过依赖检查');
    } else {
      await ensureDependencies(workDir, logger);
    }

    const workflowFiles = reRootWorkflowFiles(config.workflowFiles, repoRoot, workDir);
    await ensureWorkflowFiles(workflowFiles);

    if (preWorktreeRecords.length > 0) {
      for (const record of preWorktreeRecords) {
        await appendSection(workflowFiles.notesFile, record);
      }
      logger.success(`已写入分支名生成记录至 ${workflowFiles.notesFile}`);
    }

    const planContent = await readFileSafe(workflowFiles.planFile);
    if (planContent.trim().length === 0) {
      logger.warn('plan 文件为空，建议 AI 首轮生成计划');
    }

    if (!branchName) {
      try {
        branchName = await getCurrentBranch(workDir, logger);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`读取分支名失败，webhook 中将缺失分支信息：${message}`);
      }
    }

    const aiConfig = config.ai;
    const loadContext = async (): Promise<{ workflowGuide: string; plan: string; notes: string }> => ({
      workflowGuide: await readFileSafe(workflowFiles.workflowDoc),
      plan: await readFileSafe(workflowFiles.planFile),
      notes: await readFileSafe(workflowFiles.notesFile)
    });

    const runAiSession = async (
      stage: string,
      prompt: string,
      extras?: { testResults?: TestRunResult[]; checkResults?: CheckRunResult[]; cwd?: string }
    ): Promise<void> => {
      sessionIndex += 1;
      const webhookPlan = stage === '计划生成'
        ? normalizeText(await readFileSafe(workflowFiles.planFile))
        : undefined;
      await notifyWebhook('iteration_start', sessionIndex, stage, webhookPlan);
      logger.info(`${stage} 提示构建完成，调用 AI CLI...`);

      const aiResult = await runAi(prompt, aiConfig, logger, extras?.cwd ?? workDir);
      accumulatedUsage = mergeTokenUsage(accumulatedUsage, aiResult.usage);
      lastAiOutput = aiResult.output;

      const record = formatIterationRecord({
        iteration: sessionIndex,
        stage,
        prompt,
        aiOutput: aiResult.output,
        timestamp: isoNow(),
        testResults: extras?.testResults,
        checkResults: extras?.checkResults
      });

      await appendSection(workflowFiles.notesFile, record);
      logger.success(`已将${stage}输出写入 ${workflowFiles.notesFile}`);

      lastRound = sessionIndex;
      await runTracker?.update(sessionIndex, accumulatedUsage?.totalTokens ?? 0);
    };

    {
      const { workflowGuide, plan, notes } = await loadContext();
      const planningPrompt = buildPlanningPrompt({
        task: config.task,
        workflowGuide,
        plan,
        notes,
        branchName
      });
      await runAiSession('计划生成', planningPrompt);
    }

    let refreshedPlan = await readFileSafe(workflowFiles.planFile);
    if (hasTestKeywords(refreshedPlan)) {
      logger.warn('检测到 plan 中可能包含测试相关事项，建议保留开发内容并移除测试项。');
    }

    let pendingItems = getPendingPlanItems(refreshedPlan);
    if (pendingItems.length === 0) {
      logger.info('计划暂无待执行项，跳过计划执行循环');
      const record = formatSystemRecord('计划执行', '未发现待执行计划项，已跳过执行循环。', isoNow());
      await appendSection(workflowFiles.notesFile, record);
    }

    let planRounds = 0;
    while (pendingItems.length > 0) {
      if (planRounds >= config.iterations) {
        throw new Error('计划执行达到最大迭代次数，仍有未完成项');
      }
      const lastItem = pendingItems[pendingItems.length - 1];
      const { workflowGuide, plan, notes } = await loadContext();
      const itemPrompt = buildPlanItemPrompt({
        task: config.task,
        workflowGuide,
        plan,
        notes,
        item: lastItem.text
      });
      await runAiSession(`执行计划项：${truncateText(lastItem.text)}`, itemPrompt);
      planRounds += 1;
      refreshedPlan = await readFileSafe(workflowFiles.planFile);
      pendingItems = getPendingPlanItems(refreshedPlan);
    }

    const agentsContent = await readFileSafe(path.join(workDir, 'AGENTS.md'));
    const skipQuality = shouldSkipQuality(agentsContent, config.skipQuality);
    if (skipQuality) {
      const record = formatSystemRecord('代码质量检查', '已按配置/AGENTS.md 跳过代码质量检查。', isoNow());
      await appendSection(workflowFiles.notesFile, record);
      logger.info('已跳过代码质量检查');
    } else {
      const qualityCommands = await detectQualityCommands(workDir);
      if (qualityCommands.length === 0) {
        const record = formatSystemRecord('代码质量检查', '未检测到可执行的质量检查命令，已跳过。', isoNow());
        await appendSection(workflowFiles.notesFile, record);
        logger.info('未检测到质量检查命令，跳过该阶段');
      } else {
        let qualityResults = await runQualityChecks(qualityCommands, workDir, logger);
        const { workflowGuide, plan, notes } = await loadContext();
        const qualityPrompt = buildQualityPrompt({
          task: config.task,
          workflowGuide,
          plan,
          notes,
          commands: qualityCommands.map(item => item.command),
          results: buildCheckResultSummary(qualityResults)
        });
        await runAiSession('代码质量检查', qualityPrompt, { checkResults: qualityResults });

        let hasQualityFailure = qualityResults.some(result => !result.success);
        let fixRounds = 0;
        while (hasQualityFailure) {
          if (fixRounds >= config.iterations) {
            throw new Error('代码质量修复达到最大轮次，仍未通过');
          }
          const latest = await loadContext();
          const fixPrompt = buildFixPrompt({
            task: config.task,
            workflowGuide: latest.workflowGuide,
            plan: latest.plan,
            notes: latest.notes,
            stage: '代码质量',
            errors: buildFailedCheckSummary(qualityResults)
          });
          await runAiSession('代码质量修复', fixPrompt);
          fixRounds += 1;
          qualityResults = await runQualityChecks(qualityCommands, workDir, logger);
          hasQualityFailure = qualityResults.some(result => !result.success);

          const recheckRecord = formatSystemRecord('代码质量复核', buildCheckResultSummary(qualityResults), isoNow());
          await appendSection(workflowFiles.notesFile, recheckRecord);
        }
      }
    }

    if (config.runTests || config.runE2e) {
      let testResults = await runTestsSafely(config, workDir, logger);

      lastTestResults = testResults;
      const testCommands: string[] = [];
      if (config.runTests && config.tests.unitCommand) {
        testCommands.push(config.tests.unitCommand);
      }
      if (config.runE2e && config.tests.e2eCommand) {
        testCommands.push(config.tests.e2eCommand);
      }

      const { workflowGuide, plan, notes } = await loadContext();
      const testPrompt = buildTestPrompt({
        task: config.task,
        workflowGuide,
        plan,
        notes,
        commands: testCommands,
        results: buildTestResultSummary(testResults)
      });
      await runAiSession('测试执行', testPrompt, { testResults });

      let hasTestFailure = testResults.some(result => !result.success);
      let fixRounds = 0;
      while (hasTestFailure) {
        if (fixRounds >= config.iterations) {
          throw new Error('测试修复达到最大轮次，仍未通过');
        }
        const latest = await loadContext();
        const fixPrompt = buildFixPrompt({
          task: config.task,
          workflowGuide: latest.workflowGuide,
          plan: latest.plan,
          notes: latest.notes,
          stage: '测试',
          errors: buildFailedTestSummary(testResults)
        });
        await runAiSession('测试修复', fixPrompt, { testResults });
        fixRounds += 1;

        testResults = await runTestsSafely(config, workDir, logger);
        lastTestResults = testResults;
        hasTestFailure = testResults.some(result => !result.success);

        const recheckRecord = formatSystemRecord('测试复核', buildTestResultSummary(testResults), isoNow());
        await appendSection(workflowFiles.notesFile, recheckRecord);
      }
    } else {
      const record = formatSystemRecord('测试执行', '未开启单元测试或 e2e 测试，已跳过。', isoNow());
      await appendSection(workflowFiles.notesFile, record);
      logger.info('未开启测试阶段');
    }

    {
      const { workflowGuide, plan, notes } = await loadContext();
      const docsPrompt = buildDocsPrompt({
        task: config.task,
        workflowGuide,
        plan,
        notes
      });
      await runAiSession('文档更新', docsPrompt);
    }

    const lastTestFailed = lastTestResults?.some(result => !result.success) ?? false;
    if (lastTestFailed) {
      logger.warn('存在未通过的测试，已跳过自动提交/推送/PR');
    }

    let deliverySummary: DeliverySummary | null = null;
    const deliveryNotes: string[] = [];
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
      if (deliverySummary) {
        deliveryNotes.push(`交付摘要：提交 ${deliverySummary.commitTitle}｜PR ${deliverySummary.prTitle}`);
      }
    }
    await runTracker?.update(lastRound, accumulatedUsage?.totalTokens ?? 0);

    if (config.autoCommit) {
      if (lastTestFailed) {
        deliveryNotes.push('自动提交：已跳过（测试未通过）');
      } else {
        const summary = deliverySummary ?? buildFallbackSummary({ task: config.task, testResults: lastTestResults });
        const commitMessage: CommitMessage = {
          title: summary.commitTitle,
          body: summary.commitBody
        };
        try {
          const committed = await commitAll(commitMessage, workDir, logger);
          commitCreated = committed;
          deliveryNotes.push(committed ? `自动提交：已提交（${commitMessage.title}）` : '自动提交：未生成提交（可能无变更或提交失败）');
        } catch (error) {
          deliveryNotes.push(`自动提交：失败（${String(error)}）`);
        }
      }
    } else {
      deliveryNotes.push('自动提交：未开启');
    }

    if (config.autoPush) {
      if (lastTestFailed) {
        deliveryNotes.push('自动推送：已跳过（测试未通过）');
      } else if (!branchName) {
        deliveryNotes.push('自动推送：已跳过（缺少分支名）');
      } else {
        try {
          await pushBranch(branchName, workDir, logger);
          pushSucceeded = true;
          deliveryNotes.push(`自动推送：已推送（${branchName}）`);
        } catch (error) {
          deliveryNotes.push(`自动推送：失败（${String(error)}）`);
        }
      }
    } else {
      deliveryNotes.push('自动推送：未开启');
    }

    if (commitCreated && pushSucceeded) {
      commitLink = await resolveCommitLink(workDir, logger);
    }

    if (config.pr.enable) {
      if (lastTestFailed) {
        deliveryNotes.push('PR 创建：已跳过（测试未通过）');
      } else if (!branchName) {
        deliveryNotes.push('PR 创建：已跳过（缺少分支名）');
      } else {
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
          deliveryNotes.push(`PR 创建：已完成（${createdPr.url}）`);
          if (config.pr.autoMerge) {
            const target = createdPr.number > 0 ? createdPr.number : createdPr.url;
            const merged = await enableAutoMerge(target, workDir, logger);
            if (merged) {
              deliveryNotes.push('PR 自动合并：已启用');
            } else {
              deliveryNotes.push('PR 自动合并：启用失败');
              prFailed = true;
            }
          } else {
            deliveryNotes.push('PR 自动合并：未开启');
          }
          const failedRuns = await listFailedRuns(branchName, workDir, logger);
          if (failedRuns.length > 0) {
            failedRuns.forEach(run => {
              logger.warn(`Actions 失败: ${run.name} (${run.status}/${run.conclusion ?? 'unknown'}) ${run.url}`);
            });
          }
        } else {
          prFailed = true;
          deliveryNotes.push('PR 创建：失败（详见 gh 输出）');
          logger.error('PR 创建失败，详见上方 gh 输出');
        }
      }
    } else if (branchName) {
      logger.info('未开启 PR 创建（--pr 未传），尝试查看已有 PR');
      const existingPr = await viewPr(branchName, workDir, logger);
      prInfo = existingPr;
      if (existingPr) {
        logger.info(`已有 PR: ${existingPr.url}`);
        deliveryNotes.push(`PR 创建：未开启（已存在 PR：${existingPr.url}）`);
      } else {
        deliveryNotes.push('PR 创建：未开启（未检测到已有 PR）');
      }
    } else {
      deliveryNotes.push('PR 创建：未开启（缺少分支名）');
    }

    prLink = normalizeWebhookUrl(prInfo?.url);

    if (deliveryNotes.length > 0) {
      const record = formatSystemRecord('提交与PR', deliveryNotes.join('\n'), isoNow());
      await appendSection(workflowFiles.notesFile, record);
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

    logger.success(`wheel-ai 迭代流程结束｜Token 总计 ${accumulatedUsage?.totalTokens ?? '未知'}`);
    return { branchName };
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const stage = runError ? '任务结束（失败）' : '任务结束';
    await notifyWebhook('task_end', lastRound, stage);
    await runTracker?.finalize();
  }
}
