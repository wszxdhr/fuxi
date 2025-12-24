import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import { Command } from 'commander';
import { buildLoopConfig, CliOptions, defaultNotesPath, defaultPlanPath, defaultWorkflowDoc } from './config';
import { applyShortcutArgv, loadGlobalConfig, normalizeAliasName, upsertAliasEntry } from './global-config';
import { getCurrentBranch } from './git';
import { buildAutoLogFilePath, formatCommandLine } from './logs';
import { runAliasViewer } from './alias-viewer';
import { runLogsViewer } from './logs-viewer';
import { runLoop } from './loop';
import { defaultLogger } from './logger';
import { buildTaskPlans, normalizeTaskList, parseMultiTaskMode } from './multi-task';
import { resolveTerminationTarget, runMonitor } from './monitor';
import { tailLogFile } from './log-tailer';
import { resolvePath } from './utils';

const FOREGROUND_CHILD_ENV = 'WHEEL_AI_FOREGROUND_CHILD';

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

function extractAliasCommandArgs(argv: string[], name: string): string[] {
  const args = argv.slice(2);
  const start = args.findIndex((arg, index) => arg === 'set' && args[index + 1] === 'alias' && args[index + 2] === name);
  if (start < 0) return [];
  const rest = args.slice(start + 3);
  if (rest[0] === '--') return rest.slice(1);
  return rest;
}

async function runForegroundWithDetach(options: {
  argv: string[];
  logFile: string;
  branchName?: string;
  injectBranch: boolean;
  isMultiTask: boolean;
}): Promise<void> {
  const args = buildBackgroundArgs(options.argv, options.logFile, options.branchName, options.injectBranch);
  const child = spawn(process.execPath, [...process.execArgv, ...args], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      [FOREGROUND_CHILD_ENV]: '1'
    }
  });
  child.unref();

  const resolvedLogFile = resolvePath(process.cwd(), options.logFile);
  const existed = await fs.pathExists(resolvedLogFile);
  const tailer = await tailLogFile({
    filePath: resolvedLogFile,
    startFromEnd: existed,
    onLine: line => {
      process.stdout.write(`${line}\n`);
    },
    onError: message => {
      defaultLogger.warn(`日志读取失败：${message}`);
    }
  });

  const suffixNote = options.isMultiTask ? '（多任务将追加序号）' : '';
  console.log(`已进入前台日志查看，按 Esc 切到后台运行，日志输出至 ${resolvedLogFile}${suffixNote}`);

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await tailer.stop();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };

  const detach = async (): Promise<void> => {
    await cleanup();
    console.log(`已切入后台运行，日志输出至 ${resolvedLogFile}${suffixNote}`);
    process.exit(0);
  };

  const terminate = async (): Promise<void> => {
    if (child.pid) {
      try {
        const target = resolveTerminationTarget(child.pid);
        process.kill(target, 'SIGTERM');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        defaultLogger.warn(`终止子进程失败：${message}`);
      }
    }
    await cleanup();
    process.exit(0);
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      const input = data.toString('utf8');
      if (input === '\u001b') {
        void detach();
        return;
      }
      if (input === '\u0003') {
        void terminate();
      }
    });
  }

  process.on('SIGINT', () => {
    void terminate();
  });
  process.on('SIGTERM', () => {
    void terminate();
  });

  child.on('exit', async code => {
    await cleanup();
    process.exit(code ?? 0);
  });
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
    .option('--auto-merge', 'PR 检查通过后自动合并', false)
    .option('--webhook <url>', 'webhook 通知 URL（可重复）', collect, [])
    .option('--webhook-timeout <ms>', 'webhook 请求超时（毫秒）', value => parseInteger(value, 8000))
    .option('--multi-task-mode <mode>', '多任务执行模式（relay/serial/serial-continue/parallel，或中文描述）', 'relay')
    .option('--stop-signal <token>', 'AI 输出中的停止标记', '<<DONE>>')
    .option('--log-file <path>', '日志输出文件路径')
    .option('--background', '切入后台运行', false)
    .option('-v, --verbose', '输出调试日志', false)
    .option('--skip-quality', '跳过代码质量检查', false)
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
      const isForegroundChild = process.env[FOREGROUND_CHILD_ENV] === '1';
      const canForegroundDetach = !background && !isForegroundChild && process.stdout.isTTY && process.stdin.isTTY;

      const shouldInjectBranch = Boolean(useWorktree && branchInput && !isMultiTask);
      const branchNameForBackground = branchInput;

      let logFile = logFileInput;
      if ((background || canForegroundDetach) && !logFile) {
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

      if (canForegroundDetach) {
        if (!logFile) {
          throw new Error('切入后台需要指定日志文件');
        }
        await runForegroundWithDetach({
          argv: effectiveArgv,
          logFile,
          branchName: branchNameForBackground,
          injectBranch: shouldInjectBranch,
          isMultiTask
        });
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
        autoMerge: Boolean(options.autoMerge),
        webhookUrls: (options.webhook as string[]) ?? [],
        webhookTimeout: options.webhookTimeout as number | undefined,
        stopSignal: options.stopSignal as string,
        verbose: Boolean(options.verbose),
        skipInstall: Boolean(options.skipInstall),
        skipQuality: Boolean(options.skipQuality)
      };

      const dynamicRelay = useWorktree && multiTaskMode === 'relay' && !branchInput;
      let relayBaseBranch = options.baseBranch as string;

      const runPlan = async (plan: typeof taskPlans[number], baseBranchOverride?: string): Promise<Awaited<ReturnType<typeof runLoop>>> => {
        const cliOptions: CliOptions = {
          task: plan.task,
          ...baseOptions,
          branch: plan.branchName,
          worktreePath: plan.worktreePath,
          baseBranch: baseBranchOverride ?? plan.baseBranch,
          logFile: plan.logFile
        };
        const config = buildLoopConfig(cliOptions, process.cwd());
        return runLoop(config);
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
            const baseBranch = dynamicRelay ? relayBaseBranch : plan.baseBranch;
            const result = await runPlan(plan, baseBranch);
            if (dynamicRelay && result.branchName) {
              relayBaseBranch = result.branchName;
            }
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
        const baseBranch = dynamicRelay ? relayBaseBranch : plan.baseBranch;
        const result = await runPlan(plan, baseBranch);
        if (dynamicRelay && result.branchName) {
          relayBaseBranch = result.branchName;
        }
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
    .command('set')
    .description('写入全局配置')
    .command('alias <name> [options...]')
    .description('设置 alias')
    .allowUnknownOption(true)
    .action(async (name: string) => {
      const normalized = normalizeAliasName(name);
      if (!normalized) {
        throw new Error('alias 名称不能为空且不能包含空白字符');
      }
      const commandArgs = extractAliasCommandArgs(effectiveArgv, name);
      const commandLine = formatCommandLine(commandArgs);
      if (!commandLine) {
        throw new Error('alias 命令不能为空');
      }
      await upsertAliasEntry(normalized, commandLine);
      console.log(`已写入 alias：${normalized}`);
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
