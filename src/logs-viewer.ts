import fs from 'fs-extra';
import path from 'node:path';
import { CurrentRegistry, RunMetadata, getLogsDir, readCurrentRegistry } from './logs';
import { pad2 } from './utils';

export interface LogEntry {
  readonly fileName: string;
  readonly filePath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly meta?: RunMetadata;
}

interface ViewState {
  entry: LogEntry;
  lines: string[];
  pageOffset: number;
}

interface LogsViewerState {
  mode: 'list' | 'view';
  logs: LogEntry[];
  selectedIndex: number;
  listOffset: number;
  view?: ViewState;
  lastError?: string;
}

function isRunMetadata(value: unknown): value is RunMetadata {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.command === 'string' &&
    typeof record.round === 'number' &&
    typeof record.tokenUsed === 'number' &&
    typeof record.path === 'string'
  );
}

function buildLogMetaPath(logsDir: string, logFile: string): string {
  const baseName = path.basename(logFile, path.extname(logFile));
  return path.join(logsDir, `${baseName}.json`);
}

async function readLogMetadata(logsDir: string, logFile: string): Promise<RunMetadata | undefined> {
  const metaPath = buildLogMetaPath(logsDir, logFile);
  const exists = await fs.pathExists(metaPath);
  if (!exists) return undefined;
  try {
    const content = await fs.readFile(metaPath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return isRunMetadata(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function buildRunningLogKeys(registry: CurrentRegistry): Set<string> {
  const keys = new Set<string>();
  for (const [key, entry] of Object.entries(registry)) {
    keys.add(key);
    if (entry.logFile) {
      keys.add(path.basename(entry.logFile));
    }
  }
  return keys;
}

export async function loadLogEntries(logsDir: string, registry: CurrentRegistry): Promise<LogEntry[]> {
  const exists = await fs.pathExists(logsDir);
  if (!exists) return [];
  const running = buildRunningLogKeys(registry);
  const names = await fs.readdir(logsDir);
  const entries: LogEntry[] = [];
  for (const name of names) {
    if (path.extname(name).toLowerCase() !== '.log') continue;
    if (running.has(name)) continue;
    const filePath = path.join(logsDir, name);
    let stat: fs.Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const meta = await readLogMetadata(logsDir, filePath);
    entries.push({
      fileName: name,
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      meta
    });
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

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

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size}B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)}MB`;
}

function getPageSize(rows: number): number {
  return Math.max(1, rows - 2);
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

function buildListHeader(state: LogsViewerState, columns: number): string {
  const total = state.logs.length;
  const title = `日志列表（${total} 条）｜↑/↓ 选择  Enter 查看  q 退出`;
  return truncateLine(title, columns);
}

function buildListStatus(state: LogsViewerState, columns: number): string {
  if (state.logs.length === 0) {
    const text = state.lastError ? `加载失败：${state.lastError}` : '暂无可查看的日志';
    return truncateLine(text, columns);
  }
  const entry = state.logs[state.selectedIndex];
  const meta = entry.meta;
  const detail = meta ? `项目 ${meta.path}` : `文件 ${entry.fileName}`;
  const suffix = state.lastError ? ` ｜ 加载失败：${state.lastError}` : '';
  return truncateLine(`${detail}${suffix}`, columns);
}

function buildListLine(entry: LogEntry, selected: boolean, columns: number): string {
  const marker = selected ? '>' : ' ';
  const time = formatTimestamp(entry.mtimeMs);
  const metaInfo = entry.meta
    ? `轮次 ${entry.meta.round} ｜ Token ${entry.meta.tokenUsed}`
    : `大小 ${formatBytes(entry.size)}`;
  return truncateLine(`${marker} ${entry.fileName} ｜ ${time} ｜ ${metaInfo}`, columns);
}

function buildViewHeader(entry: LogEntry, columns: number): string {
  const title = `日志查看｜${entry.fileName}｜↑/↓ 翻页  b 返回  q 退出`;
  return truncateLine(title, columns);
}

function buildViewStatus(entry: LogEntry, page: { current: number; total: number }, columns: number): string {
  const meta = entry.meta;
  const metaInfo = meta
    ? `轮次 ${meta.round} ｜ Token ${meta.tokenUsed} ｜ 项目 ${meta.path}`
    : `文件 ${entry.fileName}`;
  const status = `页 ${page.current}/${page.total} ｜ ${metaInfo}`;
  return truncateLine(status, columns);
}

function ensureListOffset(state: LogsViewerState, pageSize: number): void {
  const total = state.logs.length;
  if (total === 0) {
    state.listOffset = 0;
    state.selectedIndex = 0;
    return;
  }
  const maxOffset = Math.max(0, total - pageSize);
  if (state.selectedIndex < state.listOffset) {
    state.listOffset = state.selectedIndex;
  }
  if (state.selectedIndex >= state.listOffset + pageSize) {
    state.listOffset = state.selectedIndex - pageSize + 1;
  }
  state.listOffset = Math.min(Math.max(state.listOffset, 0), maxOffset);
}

function renderList(state: LogsViewerState): void {
  const { rows, columns } = getTerminalSize();
  const pageSize = getPageSize(rows);
  const header = buildListHeader(state, columns);
  ensureListOffset(state, pageSize);

  if (state.logs.length === 0) {
    const filler = Array.from({ length: pageSize }, () => '');
    const status = buildListStatus(state, columns);
    const content = [header, ...filler, status].join('\n');
    process.stdout.write(`\u001b[2J\u001b[H${content}`);
    return;
  }

  const start = state.listOffset;
  const slice = state.logs.slice(start, start + pageSize);
  const lines = slice.map((entry, index) => {
    const selected = start + index === state.selectedIndex;
    return buildListLine(entry, selected, columns);
  });
  while (lines.length < pageSize) {
    lines.push('');
  }
  const status = buildListStatus(state, columns);
  const content = [header, ...lines, status].join('\n');
  process.stdout.write(`\u001b[2J\u001b[H${content}`);
}

function renderView(view: ViewState): void {
  const { rows, columns } = getTerminalSize();
  const pageSize = getPageSize(rows);
  const header = buildViewHeader(view.entry, columns);
  const maxOffset = Math.max(0, Math.ceil(view.lines.length / pageSize) - 1);
  view.pageOffset = Math.min(Math.max(view.pageOffset, 0), maxOffset);

  const start = view.pageOffset * pageSize;
  const pageLines = view.lines.slice(start, start + pageSize).map(line => truncateLine(line, columns));
  while (pageLines.length < pageSize) {
    pageLines.push('');
  }

  const status = buildViewStatus(view.entry, { current: view.pageOffset + 1, total: Math.max(1, maxOffset + 1) }, columns);
  const content = [header, ...pageLines, status].join('\n');
  process.stdout.write(`\u001b[2J\u001b[H${content}`);
}

function render(state: LogsViewerState): void {
  if (state.mode === 'view' && state.view) {
    renderView(state.view);
    return;
  }
  renderList(state);
}

function shouldExit(input: string): boolean {
  if (input === '\u0003') return true;
  if (input.toLowerCase() === 'q') return true;
  return false;
}

function isEnter(input: string): boolean {
  return input.includes('\r') || input.includes('\n');
}

function isArrowUp(input: string): boolean {
  return input.includes('\u001b[A');
}

function isArrowDown(input: string): boolean {
  return input.includes('\u001b[B');
}

function isEscape(input: string): boolean {
  return input === '\u001b';
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

function clampIndex(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(value, 0), total - 1);
}

/**
 * 启动日志列表查看界面。
 */
export async function runLogsViewer(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('当前终端不支持交互式 logs。');
    return;
  }

  const logsDir = getLogsDir();
  const state: LogsViewerState = {
    mode: 'list',
    logs: [],
    selectedIndex: 0,
    listOffset: 0
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

  let loading = false;

  const loadLogs = async (): Promise<void> => {
    try {
      const registry = await readCurrentRegistry();
      state.logs = await loadLogEntries(logsDir, registry);
      state.selectedIndex = clampIndex(state.selectedIndex, state.logs.length);
      state.lastError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message;
      state.logs = [];
      state.selectedIndex = 0;
    }
  };

  const openView = async (): Promise<void> => {
    if (loading || state.logs.length === 0) return;
    loading = true;
    const entry = state.logs[state.selectedIndex];
    state.mode = 'view';
    state.view = {
      entry,
      lines: ['加载中…'],
      pageOffset: 0
    };
    render(state);
    const lines = await readLogLines(entry.filePath);
    const pageSize = getPageSize(getTerminalSize().rows);
    const maxOffset = Math.max(0, Math.ceil(lines.length / pageSize) - 1);
    state.view = {
      entry,
      lines,
      pageOffset: maxOffset
    };
    loading = false;
    render(state);
  };

  await loadLogs();
  render(state);

  process.stdin.on('data', (data: Buffer) => {
    const input = data.toString('utf8');
    if (shouldExit(input)) {
      cleanup();
      process.exit(0);
    }

    if (state.mode === 'list') {
      if (isArrowUp(input)) {
        state.selectedIndex = clampIndex(state.selectedIndex - 1, state.logs.length);
        render(state);
        return;
      }
      if (isArrowDown(input)) {
        state.selectedIndex = clampIndex(state.selectedIndex + 1, state.logs.length);
        render(state);
        return;
      }
      if (isEnter(input)) {
        void openView();
        return;
      }
      return;
    }

    if (state.mode === 'view' && state.view) {
      if (isArrowUp(input)) {
        state.view.pageOffset -= 1;
        render(state);
        return;
      }
      if (isArrowDown(input)) {
        state.view.pageOffset += 1;
        render(state);
        return;
      }
      if (input.toLowerCase() === 'b' || isEscape(input)) {
        state.mode = 'list';
        state.view = undefined;
        render(state);
        return;
      }
    }
  });

  process.stdout.on('resize', () => {
    render(state);
  });
}
