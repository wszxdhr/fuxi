import fs from 'fs-extra';
import path from 'node:path';
import { CurrentRegistryEntry, getLogsDir, readCurrentRegistry, removeCurrentRegistry } from './logs';

interface TaskView {
  readonly key: string;
  readonly logFile: string;
  readonly meta: CurrentRegistryEntry;
  readonly lines: string[];
}

interface ConfirmState {
  readonly key: string;
}

interface TerminationResult {
  readonly message: string;
  readonly isError: boolean;
  readonly removed: boolean;
}

interface MonitorState {
  tasks: TaskView[];
  selectedIndex: number;
  selectedKey?: string;
  pageOffsets: Map<string, number>;
  stickToBottom: Map<string, boolean>;
  lastError?: string;
  confirm?: ConfirmState;
  statusMessage?: string;
  statusIsError?: boolean;
}

const REFRESH_INTERVAL = 1000;
const TERMINATE_GRACE_MS = 800;

function getTerminalSize(): { rows: number; columns: number } {
  const rows = process.stdout.rows ?? 24;
  const columns = process.stdout.columns ?? 80;
  return { rows, columns };
}

function truncateLine(line: string, width: number): string {
  if (width <= 0) return '';
  if (line.length <= width) return line;
  return line.slice(0, width);
}

function padLine(text: string, width: number): string {
  if (width <= 0) return '';
  const truncated = text.length > width ? text.slice(0, width) : text;
  const padding = width - truncated.length;
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${' '.repeat(left)}${truncated}${' '.repeat(right)}`;
}

export function buildConfirmDialogLines(taskKey: string, columns: number): string[] {
  if (columns <= 0) return [];
  const message = `确认终止任务 ${taskKey}?`;
  const hint = 'y 确认 / n 取消';
  const minWidth = Math.max(message.length, hint.length, 4);
  const innerWidth = Math.min(columns - 2, minWidth);
  if (innerWidth <= 0) {
    return [truncateLine(message, columns), truncateLine(hint, columns)];
  }
  const border = `+${'-'.repeat(innerWidth)}+`;
  const lines = [
    border,
    `|${padLine(message, innerWidth)}|`,
    `|${padLine(hint, innerWidth)}|`,
    border
  ];
  return lines.map(line => truncateLine(line, columns));
}

function applyDialogOverlay(lines: string[], dialogLines: string[]): void {
  if (lines.length === 0 || dialogLines.length === 0) return;
  const start = Math.max(0, Math.floor((lines.length - dialogLines.length) / 2));
  for (let i = 0; i < dialogLines.length && start + i < lines.length; i += 1) {
    lines[start + i] = dialogLines[i];
  }
}

export function resolveTerminationTarget(pid: number, platform: NodeJS.Platform = process.platform): number {
  return platform === 'win32' ? pid : -pid;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ESRCH') return false;
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function setStatus(state: MonitorState, message?: string, isError = false): void {
  state.statusMessage = message;
  state.statusIsError = message ? isError : false;
}

function findTaskByKey(state: MonitorState, key: string): TaskView | undefined {
  return state.tasks.find(task => task.key === key);
}

async function safeRemoveRegistry(logFile: string): Promise<void> {
  try {
    await removeCurrentRegistry(logFile);
  } catch {
    // 忽略清理失败，避免阻断 monitor 刷新
  }
}

async function readLogLines(logFile: string): Promise<string[]> {
  try {
    const content = await fs.readFile(logFile, 'utf8');
    const normalized = content.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    return lines.length > 0 ? lines : [''];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`（无法读取日志文件：${message}）`];
  }
}

async function loadTasks(logsDir: string): Promise<TaskView[]> {
  const registry = await readCurrentRegistry();
  const entries = Object.entries(registry).sort(([a], [b]) => a.localeCompare(b));
  const aliveEntries: Array<[string, CurrentRegistryEntry]> = [];
  for (const [key, meta] of entries) {
    const pid = typeof meta.pid === 'number' ? meta.pid : undefined;
    if (pid && !isProcessAlive(pid)) {
      const logFile = meta.logFile ?? path.join(logsDir, key);
      await safeRemoveRegistry(logFile);
      continue;
    }
    aliveEntries.push([key, meta]);
  }
  const tasks = await Promise.all(aliveEntries.map(async ([key, meta]) => {
    const logFile = meta.logFile ?? path.join(logsDir, key);
    const lines = await readLogLines(logFile);
    return {
      key,
      logFile,
      meta,
      lines
    } satisfies TaskView;
  }));
  return tasks;
}

function buildHeader(state: MonitorState, columns: number): string {
  if (state.tasks.length === 0) {
    return truncateLine('暂无运行中的任务，按 q 退出', columns);
  }
  const current = state.tasks[state.selectedIndex];
  const total = state.tasks.length;
  const index = state.selectedIndex + 1;
  const title = `任务 ${index}/${total} ｜ ${current.key} ｜ ←/→ 切换任务  ↑/↓ 翻页  t 终止  q 退出`;
  return truncateLine(title, columns);
}

function buildStatus(
  task: TaskView,
  page: { current: number; total: number },
  columns: number,
  errorMessage?: string,
  statusMessage?: string,
  statusIsError?: boolean
): string {
  const meta = task.meta;
  const status = `轮次 ${meta.round} ｜ Token ${meta.tokenUsed} ｜ 页 ${page.current}/${page.total} ｜ 项目 ${meta.path}`;
  const extras: string[] = [];
  if (errorMessage) {
    extras.push(`刷新失败：${errorMessage}`);
  }
  if (statusMessage) {
    extras.push(statusIsError ? `操作失败：${statusMessage}` : statusMessage);
  }
  const suffix = extras.length > 0 ? ` ｜ ${extras.join(' ｜ ')}` : '';
  return truncateLine(`${status}${suffix}`, columns);
}

function getPageSize(rows: number): number {
  return Math.max(1, rows - 2);
}

function render(state: MonitorState): void {
  const { rows, columns } = getTerminalSize();
  const pageSize = getPageSize(rows);
  const header = buildHeader(state, columns);

  if (state.tasks.length === 0) {
    const filler = Array.from({ length: pageSize }, () => '');
    const statusText = state.lastError
      ? `刷新失败：${state.lastError}`
      : state.statusMessage
      ? (state.statusIsError ? `操作失败：${state.statusMessage}` : state.statusMessage)
      : '等待后台任务启动…';
    const status = truncateLine(statusText, columns);
    const content = [header, ...filler, status].join('\n');
    process.stdout.write(`\u001b[2J\u001b[H${content}`);
    return;
  }

  const current = state.tasks[state.selectedIndex];
  const lines = current.lines;
  const maxOffset = Math.max(0, Math.ceil(lines.length / pageSize) - 1);
  const offset = state.pageOffsets.get(current.key) ?? maxOffset;
  const stick = state.stickToBottom.get(current.key) ?? true;
  const nextOffset = Math.min(Math.max(stick ? maxOffset : offset, 0), maxOffset);
  state.pageOffsets.set(current.key, nextOffset);
  state.stickToBottom.set(current.key, nextOffset === maxOffset);

  const start = nextOffset * pageSize;
  const pageLines = lines.slice(start, start + pageSize).map(line => truncateLine(line, columns));
  while (pageLines.length < pageSize) {
    pageLines.push('');
  }

  const status = buildStatus(
    current,
    { current: nextOffset + 1, total: Math.max(1, maxOffset + 1) },
    columns,
    state.lastError,
    state.statusMessage,
    state.statusIsError
  );
  if (state.confirm) {
    const dialogLines = buildConfirmDialogLines(state.confirm.key, columns);
    applyDialogOverlay(pageLines, dialogLines);
  }
  const content = [header, ...pageLines, status].join('\n');
  process.stdout.write(`\u001b[2J\u001b[H${content}`);
}

function updateSelection(state: MonitorState, tasks: TaskView[]): void {
  state.tasks = tasks;
  if (tasks.length === 0) {
    state.selectedIndex = 0;
    state.selectedKey = undefined;
    return;
  }

  if (state.selectedKey) {
    const index = tasks.findIndex(task => task.key === state.selectedKey);
    if (index >= 0) {
      state.selectedIndex = index;
    } else {
      state.selectedIndex = 0;
    }
  } else {
    state.selectedIndex = 0;
  }

  state.selectedKey = tasks[state.selectedIndex]?.key;

  const existing = new Set(tasks.map(task => task.key));
  for (const key of state.pageOffsets.keys()) {
    if (!existing.has(key)) {
      state.pageOffsets.delete(key);
    }
  }
  for (const key of state.stickToBottom.keys()) {
    if (!existing.has(key)) {
      state.stickToBottom.delete(key);
    }
  }
  if (state.confirm && !existing.has(state.confirm.key)) {
    state.confirm = undefined;
  }
}

function moveSelection(state: MonitorState, direction: -1 | 1): void {
  if (state.tasks.length === 0) return;
  const total = state.tasks.length;
  state.selectedIndex = (state.selectedIndex + direction + total) % total;
  state.selectedKey = state.tasks[state.selectedIndex]?.key;
}

function movePage(state: MonitorState, direction: -1 | 1): void {
  if (state.tasks.length === 0) return;
  const { rows } = getTerminalSize();
  const pageSize = getPageSize(rows);
  const current = state.tasks[state.selectedIndex];
  const lines = current.lines;
  const maxOffset = Math.max(0, Math.ceil(lines.length / pageSize) - 1);
  const offset = state.pageOffsets.get(current.key) ?? maxOffset;
  const nextOffset = Math.min(Math.max(offset + direction, 0), maxOffset);
  state.pageOffsets.set(current.key, nextOffset);
  state.stickToBottom.set(current.key, nextOffset === maxOffset);
}

async function terminateTask(task: TaskView): Promise<TerminationResult> {
  const pid = typeof task.meta.pid === 'number' ? task.meta.pid : undefined;
  if (!pid || pid <= 0) {
    return { message: '任务未记录 PID，无法终止', isError: true, removed: false };
  }
  const target = resolveTerminationTarget(pid);
  try {
    process.kill(target, 'SIGTERM');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ESRCH') {
      await safeRemoveRegistry(task.logFile);
      return { message: `任务 ${task.key} 已结束`, isError: false, removed: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { message: `发送终止信号失败：${message}`, isError: true, removed: false };
  }

  await sleep(TERMINATE_GRACE_MS);
  if (!isProcessAlive(pid)) {
    await safeRemoveRegistry(task.logFile);
    return { message: `任务 ${task.key} 已终止`, isError: false, removed: true };
  }
  return { message: `已发送终止信号，任务仍在运行`, isError: false, removed: false };
}

async function terminateTaskByKey(state: MonitorState, key: string, refresh: () => Promise<void>): Promise<void> {
  const task = findTaskByKey(state, key);
  if (!task) {
    setStatus(state, `任务 ${key} 已不存在`, true);
    render(state);
    return;
  }
  const result = await terminateTask(task);
  setStatus(state, result.message, result.isError);
  if (result.removed) {
    await refresh();
    render(state);
    return;
  }
  render(state);
}

function shouldExit(input: string): boolean {
  if (input === '\u0003') return true;
  if (input.toLowerCase() === 'q') return true;
  return false;
}

function handleInput(state: MonitorState, input: string, refresh: () => Promise<void>): void {
  const lower = input.toLowerCase();
  if (state.confirm) {
    if (lower.includes('y')) {
      const key = state.confirm.key;
      state.confirm = undefined;
      setStatus(state, `正在终止任务 ${key}...`);
      void terminateTaskByKey(state, key, refresh);
      return;
    }
    if (lower.includes('n') || input === '\u001b') {
      state.confirm = undefined;
      setStatus(state, '已取消终止');
      return;
    }
    return;
  }

  if (input.includes('\u001b[D')) {
    moveSelection(state, -1);
    return;
  }
  if (input.includes('\u001b[C')) {
    moveSelection(state, 1);
    return;
  }
  if (input.includes('\u001b[A')) {
    movePage(state, -1);
    return;
  }
  if (input.includes('\u001b[B')) {
    movePage(state, 1);
    return;
  }
  if (lower.includes('t')) {
    if (state.tasks.length === 0) {
      setStatus(state, '暂无可终止的任务', true);
      return;
    }
    const current = state.tasks[state.selectedIndex];
    if (typeof current.meta.pid !== 'number' || current.meta.pid <= 0) {
      setStatus(state, '任务未记录 PID，无法终止', true);
      return;
    }
    state.confirm = { key: current.key };
    setStatus(state, undefined);
  }
}

function setupCleanup(cleanup: () => void): void {
  const exitHandler = (): void => {
    cleanup();
  };
  const signalHandler = (): void => {
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
  process.on('exit', exitHandler);
}

/**
 * 启动 monitor 终端界面。
 */
export async function runMonitor(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('当前终端不支持交互式 monitor。');
    return;
  }

  const logsDir = getLogsDir();
  const state: MonitorState = {
    tasks: [],
    selectedIndex: 0,
    pageOffsets: new Map(),
    stickToBottom: new Map()
  };

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdout.write('\u001b[?25h');
  };

  setupCleanup(cleanup);
  process.stdout.write('\u001b[?25l');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let refreshing = false;

  const refresh = async (): Promise<void> => {
    if (refreshing) return;
    refreshing = true;
    try {
      const tasks = await loadTasks(logsDir);
      state.lastError = undefined;
      updateSelection(state, tasks);
      render(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message;
      render(state);
    } finally {
      refreshing = false;
    }
  };

  await refresh();

  const timer = setInterval(refresh, REFRESH_INTERVAL);

  process.stdin.on('data', (data: Buffer) => {
    const input = data.toString('utf8');
    if (shouldExit(input)) {
      clearInterval(timer);
      cleanup();
      process.exit(0);
    }
    handleInput(state, input, refresh);
    render(state);
  });

  process.stdout.on('resize', () => {
    render(state);
  });
}
