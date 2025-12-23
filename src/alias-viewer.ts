import fs from 'fs-extra';
import { AliasEntry, getGlobalConfigPath, parseAliasEntries } from './global-config';

interface AliasViewerState {
  aliases: AliasEntry[];
  selectedIndex: number;
  listOffset: number;
  missingConfig: boolean;
  lastError?: string;
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

function getPageSize(rows: number): number {
  return Math.max(1, rows - 2);
}

function buildAliasLabel(entry: AliasEntry): string {
  if (entry.source === 'shortcut') {
    return `${entry.name}（shortcut）`;
  }
  return entry.name;
}

function buildHeader(state: AliasViewerState, columns: number): string {
  const total = state.aliases.length;
  const title = `别名列表（${total} 条）｜↑/↓ 选择  q 退出`;
  return truncateLine(title, columns);
}

function buildStatus(state: AliasViewerState, columns: number): string {
  if (state.aliases.length === 0) {
    if (state.lastError) {
      return truncateLine(`读取失败：${state.lastError}`, columns);
    }
    if (state.missingConfig) {
      return truncateLine(`未找到配置文件：${getGlobalConfigPath()}`, columns);
    }
    return truncateLine('未发现 alias 配置', columns);
  }

  const entry = state.aliases[state.selectedIndex];
  const sourceText = entry.source === 'shortcut' ? '（shortcut）' : '';
  return truncateLine(`命令${sourceText}：${entry.command}`, columns);
}

function buildListLine(entry: AliasEntry, selected: boolean, columns: number): string {
  const marker = selected ? '>' : ' ';
  return truncateLine(`${marker} ${buildAliasLabel(entry)}`, columns);
}

function ensureListOffset(state: AliasViewerState, pageSize: number): void {
  const total = state.aliases.length;
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

function render(state: AliasViewerState): void {
  const { rows, columns } = getTerminalSize();
  const pageSize = getPageSize(rows);
  const header = buildHeader(state, columns);
  ensureListOffset(state, pageSize);

  if (state.aliases.length === 0) {
    const filler = Array.from({ length: pageSize }, () => '');
    const status = buildStatus(state, columns);
    const content = [header, ...filler, status].join('\n');
    process.stdout.write(`\u001b[2J\u001b[H${content}`);
    return;
  }

  const start = state.listOffset;
  const slice = state.aliases.slice(start, start + pageSize);
  const lines = slice.map((entry, index) => {
    const selected = start + index === state.selectedIndex;
    return buildListLine(entry, selected, columns);
  });
  while (lines.length < pageSize) {
    lines.push('');
  }
  const status = buildStatus(state, columns);
  const content = [header, ...lines, status].join('\n');
  process.stdout.write(`\u001b[2J\u001b[H${content}`);
}

function shouldExit(input: string): boolean {
  if (input === '\u0003') return true;
  if (input.toLowerCase() === 'q') return true;
  return false;
}

function isArrowUp(input: string): boolean {
  return input.includes('\u001b[A');
}

function isArrowDown(input: string): boolean {
  return input.includes('\u001b[B');
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
 * 启动 alias 浏览界面。
 */
export async function runAliasViewer(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('当前终端不支持交互式 alias。');
    return;
  }

  const state: AliasViewerState = {
    aliases: [],
    selectedIndex: 0,
    listOffset: 0,
    missingConfig: false
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

  const loadAliases = async (): Promise<void> => {
    const filePath = getGlobalConfigPath();
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      state.aliases = [];
      state.selectedIndex = 0;
      state.lastError = undefined;
      state.missingConfig = true;
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf8');
      state.aliases = parseAliasEntries(content);
      state.selectedIndex = clampIndex(state.selectedIndex, state.aliases.length);
      state.lastError = undefined;
      state.missingConfig = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.aliases = [];
      state.selectedIndex = 0;
      state.lastError = message;
      state.missingConfig = false;
    }
  };

  await loadAliases();
  render(state);

  process.stdin.on('data', (data: Buffer) => {
    const input = data.toString('utf8');
    if (shouldExit(input)) {
      cleanup();
      process.exit(0);
    }

    if (isArrowUp(input)) {
      state.selectedIndex = clampIndex(state.selectedIndex - 1, state.aliases.length);
      render(state);
      return;
    }
    if (isArrowDown(input)) {
      state.selectedIndex = clampIndex(state.selectedIndex + 1, state.aliases.length);
      render(state);
    }
  });

  process.stdout.on('resize', () => {
    render(state);
  });
}
