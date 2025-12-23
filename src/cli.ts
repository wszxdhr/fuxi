import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { buildLoopConfig, CliOptions, defaultNotesPath, defaultPlanPath, defaultWorkflowDoc } from './config';
import { applyShortcutArgv, loadGlobalConfig } from './global-config';
import { generateBranchName, getCurrentBranch } from './git';
import { buildAutoLogFilePath } from './logs';
import { runAliasViewer } from './alias-viewer';
import { runLogsViewer } from './logs-viewer';
import { runLoop } from './loop';
import { defaultLogger } from './logger';
import { buildTaskPlans, normalizeTaskList, parseMultiTaskMode } from './multi-task';
import { runMonitor } from './monitor';
import { resolvePath } from './utils';

function parseInteger(value: string, defaultValue: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasOption(argv: string[], option: string): boolean {
  return argv.some(arg => arg === option || arg.startsWith(`${option}=`));
}

function buildBackgroundArgs(argv: string[], logFile: string, branchName?: string, injectBranch = false): string[] {
  const rawArgs = argv.slice(1);
  const filtered = rawArgs.filter(arg => !(arg === '--background' || arg.startsWith('--background=')));
  if (!hasOption(filtered, '--log-file')) {
    filtered.push('--log-file', logFile);
  }
  if (injectBranch && branchName && !hasOption(filtered, '--branch')) {
    filtered.push('--branch', branchName);
  }
  return filtered;
}

/**
 * CLI 入口。
 */
export async function runCli(argv: string[]): Promise<void> {
  const globalConfig = await loadGlobalConfig(defaultLogger);
  const effectiveArgv = applyShortcutArgv(argv, globalConfig);
  const program = new Command();

  program
    .name('wheel-ai')
    .description('基于 AI CLI 的持续迭代开发工具')
    .version('1.0.0');

  program
    .command('run')
    .option('-t, --task <task>', '需要完成的任务描述（可重复传入，独立处理）', collect, [])
    .option('-i, --iterations <number>', '最大迭代次数', value => parseInteger(value, 5), 5)
    .option('--ai-cli <command>', 'AI CLI 命令', 'claude')
    .option('--ai-args <args...>', 'AI CLI 参数', [])
    .option('--ai-prompt-arg <flag>', '用于传入 prompt 的参数（为空则使用 stdin）')
    .option('--notes-file <path>', '持久化记忆文件', defaultNotesPath())
    .option('--plan-file <path>', '计划文件', defaultPlanPath())
    .option('--workflow-doc <path>', 'AI 工作流程说明文件', defaultWorkflowDoc())
    .option('--worktree', '在独立 worktree 上执行', false)
    .option('--branch <name>', 'worktree 分支名（默认自动生成或当前分支）')
    .option('--worktree-path <path>', 'worktree 路径，默认 ../worktrees/<branch>')
    .option('--base-branch <name>', '创建分支的基线分支', 'main')
    .option('--skip-install', '跳过开始任务前的依赖检查', false)
    .option('--run-tests', '运行单元测试命令', false)
    .option('--run-e2e', '运行 e2e 测试命令', false)
    .option('--unit-command <cmd>', '单元测试命令', 'yarn test')
    .option('--e2e-command <cmd>', 'e2e 测试命令', 'yarn e2e')
    .option('--auto-commit', '自动 git commit', false)
    .option('--auto-push', '自动 git push', false)
    .option('--pr', '使用 gh 创建 PR', false)
    .option('--pr-title <title>', 'PR 标题')
    .option('--pr-body <path>', 'PR 描述文件路径（可留空自动生成）')
    .option('--draft', '以草稿形式创建 PR', false)
    .option('--reviewer <user...>', 'PR reviewers', collect, [])
    .option('--webhook <url>', 'webhook 通知 URL（可重复）', collect, [])
    .option('--webhook-timeout <ms>', 'webhook 请求超时（毫秒）', value => parseInteger(value, 8000))
    .option('--multi-task-mode <mode>', '多任务执行模式（relay/serial/serial-continue/parallel，或中文描述）', 'relay')
    .option('--stop-signal <token>', 'AI 输出中的停止标记', '<<DONE>>')
    .option('--log-file <path>', '日志输出文件路径')
    .option('--background', '切入后台运行', false)
    .option('-v, --verbose', '输出调试日志', false)
    .action(async (options) => {
      const tasks = normalizeTaskList(options.task as string[] | string | undefined);
      if (tasks.length === 0) {
        throw new Error('需要至少提供一个任务描述');
      }

      const multiTaskMode = parseMultiTaskMode(options.multiTaskMode as string | undefined);
      const useWorktree = Boolean(options.worktree);
      if (multiTaskMode === 'parallel' && !useWorktree) {
        throw new Error('并行模式必须启用 --worktree');
      }

      const branchInput = normalizeOptional(options.branch);
      const logFileInput = normalizeOptional(options.logFile);
      const worktreePathInput = normalizeOptional(options.worktreePath);
      const background = Boolean(options.background);
      const isMultiTask = tasks.length > 1;

      const shouldInjectBranch = useWorktree && !branchInput && !isMultiTask;
      let branchNameForBackground = branchInput;
      if (shouldInjectBranch) {
        branchNameForBackground = generateBranchName();
      }

      let logFile = logFileInput;
      if (background && !logFile) {
        let branchForLog = 'multi-task';
        if (!isMultiTask) {
          branchForLog = branchNameForBackground ?? '';
          if (!branchForLog) {
            try {
              const current = await getCurrentBranch(process.cwd(), defaultLogger);
              branchForLog = current || 'detached';
            } catch {
              branchForLog = 'unknown';
            }
          }
        } else if (branchInput) {
          branchForLog = `${branchInput}-multi`;
        }
        logFile = buildAutoLogFilePath(branchForLog);
      }

      if (background) {
        if (!logFile) {
          throw new Error('后台运行需要指定日志文件');
        }
        const args = buildBackgroundArgs(effectiveArgv, logFile, branchNameForBackground, shouldInjectBranch);
        const child = spawn(process.execPath, [...process.execArgv, ...args], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        const displayLogFile = resolvePath(process.cwd(), logFile);
        const suffixNote = isMultiTask ? '（多任务将追加序号）' : '';
        console.log(`已切入后台运行，日志输出至 ${displayLogFile}${suffixNote}`);
        return;
      }

      const taskPlans = buildTaskPlans({
        tasks,
        mode: multiTaskMode,
        useWorktree,
        baseBranch: options.baseBranch as string,
        branchInput,
        worktreePath: worktreePathInput,
        logFile: logFileInput
      });

      const baseOptions = {
        iterations: options.iterations as number,
        aiCli: options.aiCli as string,
        aiArgs: (options.aiArgs as string[]) ?? [],
        aiPromptArg: options.aiPromptArg as string | undefined,
        notesFile: options.notesFile as string,
        planFile: options.planFile as string,
        workflowDoc: options.workflowDoc as string,
        useWorktree,
        runTests: Boolean(options.runTests),
        runE2e: Boolean(options.runE2e),
        unitCommand: options.unitCommand as string | undefined,
        e2eCommand: options.e2eCommand as string | undefined,
        autoCommit: Boolean(options.autoCommit),
        autoPush: Boolean(options.autoPush),
        pr: Boolean(options.pr),
        prTitle: options.prTitle as string | undefined,
        prBody: options.prBody as string | undefined,
        draft: Boolean(options.draft),
        reviewers: (options.reviewer as string[]) ?? [],
        webhookUrls: (options.webhook as string[]) ?? [],
        webhookTimeout: options.webhookTimeout as number | undefined,
        stopSignal: options.stopSignal as string,
        verbose: Boolean(options.verbose),
        skipInstall: Boolean(options.skipInstall)
      };

      const runPlan = async (plan: typeof taskPlans[number]): Promise<void> => {
        const cliOptions: CliOptions = {
          task: plan.task,
          ...baseOptions,
          branch: plan.branchName,
          worktreePath: plan.worktreePath,
          baseBranch: plan.baseBranch,
          logFile: plan.logFile
        };
        const config = buildLoopConfig(cliOptions, process.cwd());
        await runLoop(config);
      };

      if (multiTaskMode === 'parallel') {
        const results = await Promise.allSettled(taskPlans.map(plan => runPlan(plan)));
        const errors = results.flatMap((result, index) => {
          if (result.status === 'fulfilled') return [];
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          return [`任务 ${index + 1} 失败: ${reason}`];
        });
        if (errors.length > 0) {
          errors.forEach(message => defaultLogger.warn(message));
          throw new Error(errors.join('\n'));
        }
        return;
      }

      if (multiTaskMode === 'serial-continue') {
        const errors: string[] = [];
        for (const plan of taskPlans) {
          try {
            await runPlan(plan);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`任务 ${plan.index + 1} 失败: ${message}`);
            defaultLogger.warn(`任务 ${plan.index + 1} 执行失败，继续下一任务：${message}`);
          }
        }
        if (errors.length > 0) {
          throw new Error(errors.join('\n'));
        }
        return;
      }

      for (const plan of taskPlans) {
        await runPlan(plan);
      }
    });

  program
    .command('monitor')
    .description('查看后台运行日志（t 终止任务）')
    .action(async () => {
      await runMonitor();
    });

  program
    .command('logs')
    .description('查看历史日志')
    .action(async () => {
      await runLogsViewer();
    });

  program
    .command('alias')
    .alias('aliases')
    .description('浏览全局 alias 配置')
    .action(async () => {
      await runAliasViewer();
    });

  await program.parseAsync(effectiveArgv);
}

if (require.main === module) {
  runCli(process.argv).catch(error => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    defaultLogger.error(message);
    process.exitCode = 1;
  });
}
