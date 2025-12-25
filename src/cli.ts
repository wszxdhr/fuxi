import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { Command } from 'commander';
import { buildLoopConfig, CliOptions, defaultNotesPath, defaultPlanPath, defaultWorkflowDoc } from './config';
import {
  applyShortcutArgv,
  getGlobalConfigPath,
  loadGlobalConfig,
  normalizeAliasName,
  normalizeAgentName,
  parseAliasEntries,
  parseAgentEntries,
  splitCommandArgs,
  removeAliasEntry,
  removeAgentEntry,
  upsertAgentEntry,
  upsertAliasEntry
} from './global-config';
import type { AgentEntry, AliasEntry } from './global-config';
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

type OptionValueMode = 'none' | 'single' | 'variadic';

interface RunOptionSpec {
  readonly name: string;
  readonly flags: readonly string[];
  readonly valueMode: OptionValueMode;
}

interface ParsedArgSegment {
  readonly name?: string;
  readonly tokens: string[];
}

const RUN_OPTION_SPECS: RunOptionSpec[] = [
  { name: 'task', flags: ['-t', '--task'], valueMode: 'single' },
  { name: 'iterations', flags: ['-i', '--iterations'], valueMode: 'single' },
  { name: 'ai-cli', flags: ['--ai-cli'], valueMode: 'single' },
  { name: 'ai-args', flags: ['--ai-args'], valueMode: 'variadic' },
  { name: 'ai-prompt-arg', flags: ['--ai-prompt-arg'], valueMode: 'single' },
  { name: 'notes-file', flags: ['--notes-file'], valueMode: 'single' },
  { name: 'plan-file', flags: ['--plan-file'], valueMode: 'single' },
  { name: 'workflow-doc', flags: ['--workflow-doc'], valueMode: 'single' },
  { name: 'worktree', flags: ['--worktree'], valueMode: 'none' },
  { name: 'branch', flags: ['--branch'], valueMode: 'single' },
  { name: 'worktree-path', flags: ['--worktree-path'], valueMode: 'single' },
  { name: 'base-branch', flags: ['--base-branch'], valueMode: 'single' },
  { name: 'skip-install', flags: ['--skip-install'], valueMode: 'none' },
  { name: 'run-tests', flags: ['--run-tests'], valueMode: 'none' },
  { name: 'run-e2e', flags: ['--run-e2e'], valueMode: 'none' },
  { name: 'unit-command', flags: ['--unit-command'], valueMode: 'single' },
  { name: 'e2e-command', flags: ['--e2e-command'], valueMode: 'single' },
  { name: 'auto-commit', flags: ['--auto-commit'], valueMode: 'none' },
  { name: 'auto-push', flags: ['--auto-push'], valueMode: 'none' },
  { name: 'pr', flags: ['--pr'], valueMode: 'none' },
  { name: 'pr-title', flags: ['--pr-title'], valueMode: 'single' },
  { name: 'pr-body', flags: ['--pr-body'], valueMode: 'single' },
  { name: 'draft', flags: ['--draft'], valueMode: 'none' },
  { name: 'reviewer', flags: ['--reviewer'], valueMode: 'variadic' },
  { name: 'auto-merge', flags: ['--auto-merge'], valueMode: 'none' },
  { name: 'webhook', flags: ['--webhook'], valueMode: 'single' },
  { name: 'webhook-timeout', flags: ['--webhook-timeout'], valueMode: 'single' },
  { name: 'multi-task-mode', flags: ['--multi-task-mode'], valueMode: 'single' },
  { name: 'stop-signal', flags: ['--stop-signal'], valueMode: 'single' },
  { name: 'log-file', flags: ['--log-file'], valueMode: 'single' },
  { name: 'background', flags: ['--background'], valueMode: 'none' },
  { name: 'verbose', flags: ['-v', '--verbose'], valueMode: 'none' },
  { name: 'skip-quality', flags: ['--skip-quality'], valueMode: 'none' }
];

const RUN_OPTION_FLAG_MAP = new Map<string, RunOptionSpec>(
  RUN_OPTION_SPECS.flatMap(spec => spec.flags.map(flag => [flag, spec] as const))
);

const USE_ALIAS_FLAG = '--use-alias';
const USE_AGENT_FLAG = '--use-agent';
const PACKAGE_VERSION_FALLBACK = '0.0.0';

/**
 * 读取 package.json 中的版本号，失败时返回兜底值。
 */
async function resolveCliVersion(): Promise<string> {
  const candidatePaths = [
    path.resolve(__dirname, '..', 'package.json'),
    path.resolve(process.cwd(), 'package.json')
  ];

  for (const candidatePath of candidatePaths) {
    const exists = await fs.pathExists(candidatePath);
    if (!exists) continue;
    try {
      const pkg = (await fs.readJson(candidatePath)) as { version?: unknown };
      if (typeof pkg?.version === 'string') {
        const trimmed = pkg.version.trim();
        if (trimmed.length > 0) return trimmed;
      }
    } catch {
      // 读取失败则继续尝试下一个路径。
    }
  }

  return PACKAGE_VERSION_FALLBACK;
}

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
  const start = args.findIndex((arg, index) => {
    const legacyMatch = arg === 'set' && args[index + 1] === 'alias' && args[index + 2] === name;
    const aliasMatch =
      isAliasCommandToken(arg) && args[index + 1] === 'set' && args[index + 2] === name;
    return legacyMatch || aliasMatch;
  });
  if (start < 0) return [];
  const rest = args.slice(start + 3);
  if (rest[0] === '--') return rest.slice(1);
  return rest;
}

function extractAgentCommandArgs(argv: string[], action: 'add' | 'set', name: string): string[] {
  const args = argv.slice(2);
  const start = args.findIndex(
    (arg, index) => arg === 'agent' && args[index + 1] === action && args[index + 2] === name
  );
  if (start < 0) return [];
  const rest = args.slice(start + 3);
  if (rest[0] === '--') return rest.slice(1);
  return rest;
}

function isAliasCommandToken(token: string): boolean {
  return token === 'alias' || token === 'aliases';
}

function extractAliasRunArgs(argv: string[], name: string): string[] {
  const args = argv.slice(2);
  const start = args.findIndex(
    (arg, index) => isAliasCommandToken(arg) && args[index + 1] === 'run' && args[index + 2] === name
  );
  if (start < 0) return [];
  const rest = args.slice(start + 3);
  if (rest[0] === '--') return rest.slice(1);
  return rest;
}

function normalizeRunCommandArgs(args: string[]): string[] {
  let start = 0;
  if (args[start] === 'wheel-ai') {
    start += 1;
  }
  if (args[start] === 'run') {
    start += 1;
  }
  return args.slice(start);
}

function resolveRunOptionSpec(token: string): { spec: RunOptionSpec; inlineValue?: string } | null {
  const equalIndex = token.indexOf('=');
  const flag = equalIndex > 0 ? token.slice(0, equalIndex) : token;
  const spec = RUN_OPTION_FLAG_MAP.get(flag);
  if (!spec) return null;
  if (equalIndex > 0) {
    return { spec, inlineValue: token.slice(equalIndex + 1) };
  }
  return { spec };
}

function parseArgSegments(tokens: string[]): ParsedArgSegment[] {
  const segments: ParsedArgSegment[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') {
      segments.push({ tokens: tokens.slice(index) });
      break;
    }

    const match = resolveRunOptionSpec(token);
    if (!match) {
      segments.push({ tokens: [token] });
      index += 1;
      continue;
    }

    if (match.inlineValue !== undefined) {
      segments.push({ name: match.spec.name, tokens: [token] });
      index += 1;
      continue;
    }

    if (match.spec.valueMode === 'none') {
      segments.push({ name: match.spec.name, tokens: [token] });
      index += 1;
      continue;
    }

    if (match.spec.valueMode === 'single') {
      const next = tokens[index + 1];
      if (next !== undefined) {
        segments.push({ name: match.spec.name, tokens: [token, next] });
        index += 2;
      } else {
        segments.push({ name: match.spec.name, tokens: [token] });
        index += 1;
      }
      continue;
    }

    const values: string[] = [];
    let cursor = index + 1;
    while (cursor < tokens.length) {
      const next = tokens[cursor];
      if (next === '--') break;
      const nextMatch = resolveRunOptionSpec(next);
      if (nextMatch) break;
      values.push(next);
      cursor += 1;
    }
    segments.push({ name: match.spec.name, tokens: [token, ...values] });
    index = cursor;
  }

  return segments;
}

// 按选项名合并 run 参数，同名选项以“后出现覆盖前出现”为准。
function mergeRunCommandArgs(baseTokens: string[], additionTokens: string[]): string[] {
  const baseSegments = parseArgSegments(baseTokens);
  const additionSegments = parseArgSegments(additionTokens);
  const overrideNames = new Set(
    additionSegments.flatMap(segment => (segment.name ? [segment.name] : []))
  );

  const merged = [
    ...baseSegments.filter(segment => !segment.name || !overrideNames.has(segment.name)),
    ...additionSegments
  ];

  return merged.flatMap(segment => segment.tokens);
}

interface ExpandedRunTokens {
  readonly tokens: string[];
  readonly expanded: boolean;
}

interface UseOptionMatch {
  readonly type: 'alias' | 'agent';
  readonly name: string;
  readonly nextIndex: number;
}

function extractRunCommandArgs(argv: string[]): string[] {
  const args = argv.slice(2);
  const start = args.findIndex(arg => arg === 'run');
  if (start < 0) return [];
  return args.slice(start + 1);
}

function parseUseOptionToken(token: string, flag: string): { matched: boolean; value?: string } {
  if (token === flag) {
    return { matched: true };
  }
  if (token.startsWith(`${flag}=`)) {
    return { matched: true, value: token.slice(flag.length + 1) };
  }
  return { matched: false };
}

function resolveUseOption(tokens: string[], index: number): UseOptionMatch | null {
  const token = tokens[index];
  const aliasMatch = parseUseOptionToken(token, USE_ALIAS_FLAG);
  if (aliasMatch.matched) {
    const value = aliasMatch.value ?? tokens[index + 1];
    if (!value) {
      throw new Error(`${USE_ALIAS_FLAG} 需要提供名称`);
    }
    const nextIndex = aliasMatch.value ? index + 1 : index + 2;
    return { type: 'alias', name: value, nextIndex };
  }

  const agentMatch = parseUseOptionToken(token, USE_AGENT_FLAG);
  if (agentMatch.matched) {
    const value = agentMatch.value ?? tokens[index + 1];
    if (!value) {
      throw new Error(`${USE_AGENT_FLAG} 需要提供名称`);
    }
    const nextIndex = agentMatch.value ? index + 1 : index + 2;
    return { type: 'agent', name: value, nextIndex };
  }

  return null;
}

function buildAliasRunArgs(entry: AliasEntry): string[] {
  return normalizeRunCommandArgs(splitCommandArgs(entry.command));
}

function buildAgentRunArgs(entry: AgentEntry): string[] {
  const tokens = normalizeRunCommandArgs(splitCommandArgs(entry.command));
  if (tokens.length === 0) return [];
  if (tokens[0].startsWith('-')) {
    return tokens;
  }
  const [command, ...args] = tokens;
  if (args.length === 0) {
    return ['--ai-cli', command];
  }
  return ['--ai-cli', command, '--ai-args', ...args];
}

function expandRunTokens(
  tokens: string[],
  lookup: { aliasEntries: Map<string, AliasEntry>; agentEntries: Map<string, AgentEntry> },
  stack: { alias: Set<string>; agent: Set<string> }
): ExpandedRunTokens {
  let mergedTokens: string[] = [];
  let buffer: string[] = [];
  let expanded = false;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') {
      buffer.push(...tokens.slice(index));
      break;
    }

    const match = resolveUseOption(tokens, index);
    if (!match) {
      buffer.push(token);
      index += 1;
      continue;
    }

    if (buffer.length > 0) {
      mergedTokens = mergeRunCommandArgs(mergedTokens, buffer);
      buffer = [];
    }

    expanded = true;

    if (match.type === 'alias') {
      const normalized = normalizeAliasName(match.name);
      if (!normalized) {
        throw new Error('alias 名称不能为空且不能包含空白字符');
      }
      if (stack.alias.has(normalized)) {
        throw new Error(`alias 循环引用：${normalized}`);
      }
      const entry = lookup.aliasEntries.get(normalized);
      if (!entry) {
        throw new Error(`未找到 alias：${normalized}`);
      }
      stack.alias.add(normalized);
      const resolved = expandRunTokens(buildAliasRunArgs(entry), lookup, stack);
      stack.alias.delete(normalized);
      mergedTokens = mergeRunCommandArgs(mergedTokens, resolved.tokens);
      index = match.nextIndex;
      continue;
    }

    const normalized = normalizeAgentName(match.name);
    if (!normalized) {
      throw new Error('agent 名称不能为空且不能包含空白字符');
    }
    if (stack.agent.has(normalized)) {
      throw new Error(`agent 循环引用：${normalized}`);
    }
    const entry = lookup.agentEntries.get(normalized);
    if (!entry) {
      throw new Error(`未找到 agent：${normalized}`);
    }
    stack.agent.add(normalized);
    const resolved = expandRunTokens(buildAgentRunArgs(entry), lookup, stack);
    stack.agent.delete(normalized);
    mergedTokens = mergeRunCommandArgs(mergedTokens, resolved.tokens);
    index = match.nextIndex;
  }

  if (buffer.length > 0) {
    mergedTokens = mergeRunCommandArgs(mergedTokens, buffer);
  }

  return { tokens: mergedTokens, expanded };
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
  const cliVersion = await resolveCliVersion();
  const program = new Command();

  program
    .name('wheel-ai')
    .description('基于 AI CLI 的持续迭代开发工具')
    .version(cliVersion);
  program.enablePositionalOptions();
  program.addHelpText(
    'after',
    '\nalias 管理：\n  wheel-ai alias set <name> <options...>\n  wheel-ai alias list\n  wheel-ai alias delete <name>\n\nalias/agent 叠加：\n  wheel-ai run --use-alias <name> [--use-alias <name>...]\n  wheel-ai run --use-agent <name> [--use-agent <name>...]\n  同名选项按出现顺序覆盖。\n\nagent 录入包含选项时使用 -- 终止解析：\n  wheel-ai agent set <name> -- <command...>\n  例如：wheel-ai agent set glm -- goose run --text\n'
  );

  program
    .command('run')
    .option('-t, --task <task>', '需要完成的任务描述（可重复传入，独立处理）', collect, [])
    .option('--use-alias <name>', '叠加 alias 配置（可重复）', collect, [])
    .option('--use-agent <name>', '叠加 agent 配置（可重复）', collect, [])
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
      const rawRunArgs = extractRunCommandArgs(effectiveArgv);
      const hasUseOptions = rawRunArgs.some(
        token =>
          token === USE_ALIAS_FLAG ||
          token.startsWith(`${USE_ALIAS_FLAG}=`) ||
          token === USE_AGENT_FLAG ||
          token.startsWith(`${USE_AGENT_FLAG}=`)
      );

      if (hasUseOptions) {
        const filePath = getGlobalConfigPath();
        const exists = await fs.pathExists(filePath);
        const content = exists ? await fs.readFile(filePath, 'utf8') : '';
        const aliasEntries = parseAliasEntries(content);
        const agentEntries = parseAgentEntries(content);
        const resolved = expandRunTokens(
          rawRunArgs,
          {
            aliasEntries: new Map(aliasEntries.map(entry => [entry.name, entry])),
            agentEntries: new Map(agentEntries.map(entry => [entry.name, entry]))
          },
          {
            alias: new Set<string>(),
            agent: new Set<string>()
          }
        );

        if (resolved.expanded) {
          const nextArgv = [process.argv[0], process.argv[1], 'run', ...resolved.tokens];
          const originalArgv = process.argv;
          process.argv = nextArgv;
          try {
            await runCli(nextArgv);
          } finally {
            process.argv = originalArgv;
          }
          return;
        }
      }

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

  const agentCommand = program
    .command('agent')
    .description('管理 AI CLI agent 配置');

  agentCommand
    .command('add <name> [command...]')
    .description('新增 agent')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (name: string) => {
      const normalized = normalizeAgentName(name);
      if (!normalized) {
        throw new Error('agent 名称不能为空且不能包含空白字符');
      }
      const commandArgs = extractAgentCommandArgs(effectiveArgv, 'add', name);
      const commandLine = formatCommandLine(commandArgs);
      if (!commandLine) {
        throw new Error('agent 命令不能为空');
      }

      const filePath = getGlobalConfigPath();
      const exists = await fs.pathExists(filePath);
      const content = exists ? await fs.readFile(filePath, 'utf8') : '';
      const entries = parseAgentEntries(content);
      if (entries.some(entry => entry.name === normalized)) {
        throw new Error(`agent 已存在：${normalized}`);
      }

      await upsertAgentEntry(normalized, commandLine);
      console.log(`已新增 agent：${normalized}`);
    });

  agentCommand
    .command('set <name> [command...]')
    .description('写入 agent')
    .passThroughOptions()
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (name: string) => {
      const normalized = normalizeAgentName(name);
      if (!normalized) {
        throw new Error('agent 名称不能为空且不能包含空白字符');
      }
      const commandArgs = extractAgentCommandArgs(effectiveArgv, 'set', name);
      const commandLine = formatCommandLine(commandArgs);
      if (!commandLine) {
        throw new Error('agent 命令不能为空');
      }
      await upsertAgentEntry(normalized, commandLine);
      console.log(`已写入 agent：${normalized}`);
    });

  agentCommand
    .command('delete <name>')
    .description('删除 agent')
    .action(async (name: string) => {
      const normalized = normalizeAgentName(name);
      if (!normalized) {
        throw new Error('agent 名称不能为空且不能包含空白字符');
      }

      const filePath = getGlobalConfigPath();
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        throw new Error(`未找到 agent 配置文件：${filePath}`);
      }

      const removed = await removeAgentEntry(normalized);
      if (!removed) {
        throw new Error(`未找到 agent：${normalized}`);
      }
      console.log(`已删除 agent：${normalized}`);
    });

  agentCommand
    .command('list')
    .description('列出 agent 配置')
    .action(async () => {
      const filePath = getGlobalConfigPath();
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        console.log('未发现 agent 配置');
        return;
      }

      const content = await fs.readFile(filePath, 'utf8');
      const entries = parseAgentEntries(content);
      if (entries.length === 0) {
        console.log('未发现 agent 配置');
        return;
      }

      entries.forEach(entry => {
        console.log(`${entry.name}: ${entry.command}`);
      });
    });

  agentCommand.action(() => {
    agentCommand.help();
  });

  const aliasCommand = program
    .command('alias')
    .alias('aliases')
    .description('管理全局 alias 配置');

  aliasCommand
    .command('set <name> [options...]')
    .description('写入 alias')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
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

  aliasCommand
    .command('list')
    .description('列出 alias 配置')
    .action(async () => {
      const filePath = getGlobalConfigPath();
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        console.log('未发现 alias 配置');
        return;
      }

      const content = await fs.readFile(filePath, 'utf8');
      const entries = parseAliasEntries(content).filter(entry => entry.source === 'alias');
      if (entries.length === 0) {
        console.log('未发现 alias 配置');
        return;
      }

      entries.forEach(entry => {
        console.log(`${entry.name}: ${entry.command}`);
      });
    });

  aliasCommand
    .command('delete <name>')
    .description('删除 alias')
    .action(async (name: string) => {
      const normalized = normalizeAliasName(name);
      if (!normalized) {
        throw new Error('alias 名称不能为空且不能包含空白字符');
      }

      const filePath = getGlobalConfigPath();
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        throw new Error(`未找到 alias 配置文件：${filePath}`);
      }

      const removed = await removeAliasEntry(normalized);
      if (!removed) {
        throw new Error(`未找到 alias：${normalized}`);
      }
      console.log(`已删除 alias：${normalized}`);
    });

  aliasCommand
    .command('run <name> [addition...]')
    .description('执行 alias 并追加命令')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (name: string) => {
      const normalized = normalizeAliasName(name);
      if (!normalized) {
        throw new Error('alias 名称不能为空且不能包含空白字符');
      }

      const filePath = getGlobalConfigPath();
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        throw new Error(`未找到 alias 配置文件：${filePath}`);
      }

      const content = await fs.readFile(filePath, 'utf8');
      const entries = parseAliasEntries(content);
      const entry = entries.find(item => item.name === normalized);
      if (!entry) {
        throw new Error(`未找到 alias：${normalized}`);
      }

      const aliasTokens = normalizeRunCommandArgs(splitCommandArgs(entry.command));
      const additionTokens = extractAliasRunArgs(effectiveArgv, normalized);
      const mergedTokens = mergeRunCommandArgs(aliasTokens, additionTokens);
      if (mergedTokens.length === 0) {
        throw new Error('alias 命令不能为空');
      }

      const nextArgv = [process.argv[0], process.argv[1], 'run', ...mergedTokens];
      const originalArgv = process.argv;
      process.argv = nextArgv;
      try {
        await runCli(nextArgv);
      } finally {
        process.argv = originalArgv;
      }
    });

  aliasCommand.action(async () => {
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
