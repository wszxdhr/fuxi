import fs from 'fs-extra';
import path from 'node:path';
import { CurrentRegistryEntry, getLogsDir, readCurrentRegistry } from './logs';

interface TaskView {
  readonly key: string;
  readonly logFile: string;
  readonly meta: CurrentRegistryEntry;
  readonly lines: string[];
}

interface MonitorState {
  tasks: TaskView[];
  selectedIndex: number;
  selectedKey?: string;
  pageOffsets: Map<string, number>;
  stickToBottom: Map<string, boolean>;
  lastError?: string;
}

const REFRESH_INTERVAL = 1000;

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
  const tasks = await Promise.all(entries.map(async ([key, meta]) => {
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
  const title = `任务 ${index}/${total} ｜ ${current.key} ｜ ←/→ 切换任务  ↑/↓ 翻页  q 退出`;
  return truncateLine(title, columns);
}

function buildStatus(
  task: TaskView,
  page: { current: number; total: number },
  columns: number,
  errorMessage?: string
): string {
  const meta = task.meta;
  const status = `轮次 ${meta.round} ｜ Token ${meta.tokenUsed} ｜ 页 ${page.current}/${page.total} ｜ 项目 ${meta.path}`;
  const suffix = errorMessage ? ` ｜ 刷新失败：${errorMessage}` : '';
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
    const statusText = state.lastError ? `刷新失败：${state.lastError}` : '等待后台任务启动…';
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
    state.lastError
  );
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

function shouldExit(input: string): boolean {
  if (input === '\u0003') return true;
  if (input.toLowerCase() === 'q') return true;
  return false;
}

function handleInput(state: MonitorState, input: string): void {
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
    handleInput(state, input);
    render(state);
  });

  process.stdout.on('resize', () => {
    render(state);
  });
}
