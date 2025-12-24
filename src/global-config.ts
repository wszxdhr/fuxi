import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { Logger } from './logger';

/**
 * 全局快捷指令配置。
 */
export interface ShortcutConfig {
  readonly name: string;
  readonly command: string;
}

/**
 * 全局 alias 配置条目。
 */
export interface AliasEntry {
  readonly name: string;
  readonly command: string;
  readonly source: 'alias' | 'shortcut';
}

/**
 * 全局 agent 配置条目。
 */
export interface AgentEntry {
  readonly name: string;
  readonly command: string;
}

/**
 * 全局配置结构。
 */
export interface GlobalConfig {
  readonly shortcut?: ShortcutConfig;
}

/**
 * 获取全局配置文件路径。
 */
export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.wheel-ai', 'config.toml');
}

function stripTomlComment(line: string): string {
  let quote: '"' | '\'' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === '#' || char === ';') {
      return line.slice(0, i);
    }
  }
  return line;
}

function findUnquotedIndex(text: string, target: string): number {
  let quote: '"' | '\'' | null = null;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === target) {
      return i;
    }
  }
  return -1;
}

function parseTomlString(raw: string): string | null {
  const value = raw.trim();
  if (value.length < 2) return null;
  const quote = value[0];
  if (quote !== '"' && quote !== '\'') return null;
  let result = '';
  let escaped = false;
  for (let i = 1; i < value.length; i += 1) {
    const char = value[i];
    if (quote === '"') {
      if (escaped) {
        switch (char) {
          case 'n':
            result += '\n';
            break;
          case 't':
            result += '\t';
            break;
          case 'r':
            result += '\r';
            break;
          case '"':
          case '\\':
            result += char;
            break;
          default:
            result += char;
            break;
        }
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        const rest = value.slice(i + 1).trim();
        if (rest.length > 0) return null;
        return result;
      }
      result += char;
      continue;
    }

    if (char === quote) {
      const rest = value.slice(i + 1).trim();
      if (rest.length > 0) return null;
      return result;
    }
    result += char;
  }
  return null;
}

function parseTomlKeyValue(line: string): { key: string; value: string } | null {
  const equalIndex = findUnquotedIndex(line, '=');
  if (equalIndex <= 0) return null;

  const key = line.slice(0, equalIndex).trim();
  const valuePart = line.slice(equalIndex + 1).trim();
  if (!key || !valuePart) return null;

  const parsedValue = parseTomlString(valuePart);
  if (parsedValue === null) return null;

  return { key, value: parsedValue };
}

function normalizeShortcutName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 规范化 alias 名称。
 */
export function normalizeAliasName(name: string): string | null {
  return normalizeShortcutName(name);
}

/**
 * 规范化 agent 名称。
 */
export function normalizeAgentName(name: string): string | null {
  return normalizeShortcutName(name);
}

function formatTomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

interface SectionRange {
  readonly name: string;
  readonly start: number;
  end: number;
}

function collectSectionRanges(lines: string[]): SectionRange[] {
  const ranges: SectionRange[] = [];
  let current: SectionRange | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*\[(.+?)\]\s*$/.exec(lines[i]);
    if (!match) continue;

    if (current) {
      current.end = i;
      ranges.push(current);
    }

    current = {
      name: match[1].trim(),
      start: i,
      end: lines.length
    };
  }

  if (current) {
    ranges.push(current);
  }

  return ranges;
}

function isAgentSection(name: string | null): boolean {
  return name === 'agent' || name === 'agents';
}

/**
 * 更新 alias 配置内容，返回新文本。
 */
export function updateAliasContent(content: string, name: string, command: string): string {
  const lines = content.split(/\r?\n/);
  const entryLine = `${name} = ${formatTomlString(command)}`;
  let currentSection: string | null = null;
  let aliasStart = -1;
  let aliasEnd = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*\[(.+?)\]\s*$/.exec(lines[i]);
    if (!match) continue;
    if (currentSection === 'alias' && aliasStart >= 0 && aliasEnd === lines.length) {
      aliasEnd = i;
    }
    currentSection = match[1].trim();
    if (currentSection === 'alias') {
      aliasStart = i;
    }
  }

  if (aliasStart < 0) {
    const trimmed = content.trimEnd();
    const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
    return `${prefix}[alias]\n${entryLine}\n`;
  }

  let replaced = false;
  for (let i = aliasStart + 1; i < aliasEnd; i += 1) {
    const parsed = parseTomlKeyValue(stripTomlComment(lines[i]).trim());
    if (!parsed) continue;
    if (parsed.key === name) {
      lines[i] = entryLine;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    lines.splice(aliasEnd, 0, entryLine);
  }

  const output = lines.join('\n');
  return output.endsWith('\n') ? output : `${output}\n`;
}

/**
 * 写入或更新 alias 配置。
 */
export async function upsertAliasEntry(name: string, command: string, filePath: string = getGlobalConfigPath()): Promise<void> {
  const exists = await fs.pathExists(filePath);
  const content = exists ? await fs.readFile(filePath, 'utf8') : '';
  const nextContent = updateAliasContent(content, name, command);
  await fs.mkdirp(path.dirname(filePath));
  await fs.writeFile(filePath, nextContent, 'utf8');
}

function ensureTrailingNewline(content: string): string {
  if (!content) return '';
  return content.endsWith('\n') ? content : `${content}\n`;
}

function findAgentRangeWithEntry(lines: string[], ranges: SectionRange[], name: string): SectionRange | null {
  for (const range of ranges) {
    for (let i = range.start + 1; i < range.end; i += 1) {
      const parsed = parseTomlKeyValue(stripTomlComment(lines[i]).trim());
      if (!parsed) continue;
      if (parsed.key === name) return range;
    }
  }
  return null;
}

/**
 * 更新 agent 配置内容，返回新文本。
 */
export function updateAgentContent(content: string, name: string, command: string): string {
  const lines = content.split(/\r?\n/);
  const entryLine = `${name} = ${formatTomlString(command)}`;
  const ranges = collectSectionRanges(lines);
  const agentRanges = ranges.filter(range => isAgentSection(range.name));
  let targetRange = findAgentRangeWithEntry(lines, agentRanges, name);

  if (!targetRange) {
    targetRange = agentRanges.find(range => range.name === 'agent') ?? agentRanges.find(range => range.name === 'agents') ?? null;
  }

  if (!targetRange) {
    const trimmed = content.trimEnd();
    const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
    return `${prefix}[agent]\n${entryLine}\n`;
  }

  let replaced = false;
  for (let i = targetRange.start + 1; i < targetRange.end; i += 1) {
    const parsed = parseTomlKeyValue(stripTomlComment(lines[i]).trim());
    if (!parsed) continue;
    if (parsed.key === name) {
      lines[i] = entryLine;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    lines.splice(targetRange.end, 0, entryLine);
  }

  const output = lines.join('\n');
  return output.endsWith('\n') ? output : `${output}\n`;
}

/**
 * 删除 agent 配置内容，返回删除结果与新文本。
 */
export function removeAgentContent(content: string, name: string): { removed: boolean; nextContent: string } {
  const lines = content.split(/\r?\n/);
  const ranges = collectSectionRanges(lines).filter(range => isAgentSection(range.name));
  const removeIndices: number[] = [];

  for (const range of ranges) {
    for (let i = range.start + 1; i < range.end; i += 1) {
      const parsed = parseTomlKeyValue(stripTomlComment(lines[i]).trim());
      if (!parsed) continue;
      if (parsed.key === name) {
        removeIndices.push(i);
      }
    }
  }

  if (removeIndices.length === 0) {
    return { removed: false, nextContent: ensureTrailingNewline(content) };
  }

  removeIndices
    .sort((a, b) => b - a)
    .forEach(index => {
      lines.splice(index, 1);
    });

  const output = lines.join('\n');
  return { removed: true, nextContent: output.endsWith('\n') ? output : `${output}\n` };
}

/**
 * 写入或更新 agent 配置。
 */
export async function upsertAgentEntry(name: string, command: string, filePath: string = getGlobalConfigPath()): Promise<void> {
  const exists = await fs.pathExists(filePath);
  const content = exists ? await fs.readFile(filePath, 'utf8') : '';
  const nextContent = updateAgentContent(content, name, command);
  await fs.mkdirp(path.dirname(filePath));
  await fs.writeFile(filePath, nextContent, 'utf8');
}

/**
 * 删除 agent 配置，返回是否删除成功。
 */
export async function removeAgentEntry(name: string, filePath: string = getGlobalConfigPath()): Promise<boolean> {
  const exists = await fs.pathExists(filePath);
  if (!exists) return false;
  const content = await fs.readFile(filePath, 'utf8');
  const { removed, nextContent } = removeAgentContent(content, name);
  if (!removed) return false;
  await fs.writeFile(filePath, nextContent, 'utf8');
  return true;
}

/**
 * 解析全局 TOML 配置文本。
 */
export function parseGlobalConfig(content: string): GlobalConfig {
  const lines = content.split(/\r?\n/);
  let currentSection: string | null = null;
  const shortcut: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (currentSection !== 'shortcut') continue;
    const parsed = parseTomlKeyValue(line);
    if (!parsed) continue;

    shortcut[parsed.key] = parsed.value;
  }

  const name = normalizeShortcutName(shortcut.name ?? '');
  const command = (shortcut.command ?? '').trim();
  if (!name || !command) {
    return {};
  }

  return {
    shortcut: {
      name,
      command
    }
  };
}

/**
 * 解析 alias 配置条目（含 shortcut 作为补充来源）。
 */
export function parseAliasEntries(content: string): AliasEntry[] {
  const lines = content.split(/\r?\n/);
  let currentSection: string | null = null;
  const entries: AliasEntry[] = [];
  const names = new Set<string>();

  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (currentSection !== 'alias') continue;
    const parsed = parseTomlKeyValue(line);
    if (!parsed) continue;

    const name = normalizeShortcutName(parsed.key);
    const command = parsed.value.trim();
    if (!name || !command) continue;
    if (names.has(name)) continue;

    names.add(name);
    entries.push({
      name,
      command,
      source: 'alias'
    });
  }

  const shortcut = parseGlobalConfig(content).shortcut;
  if (shortcut && !names.has(shortcut.name)) {
    entries.push({
      name: shortcut.name,
      command: shortcut.command,
      source: 'shortcut'
    });
  }

  return entries;
}

/**
 * 解析 agent 配置条目（支持 [agent]/[agents]）。
 */
export function parseAgentEntries(content: string): AgentEntry[] {
  const lines = content.split(/\r?\n/);
  let currentSection: string | null = null;
  const entries: AgentEntry[] = [];
  const names = new Set<string>();

  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (!isAgentSection(currentSection)) continue;
    const parsed = parseTomlKeyValue(line);
    if (!parsed) continue;

    const name = normalizeShortcutName(parsed.key);
    const command = parsed.value.trim();
    if (!name || !command) continue;
    if (names.has(name)) continue;

    names.add(name);
    entries.push({
      name,
      command
    });
  }

  return entries;
}

/**
 * 读取用户目录下的全局配置。
 */
export async function loadGlobalConfig(logger?: Logger): Promise<GlobalConfig | null> {
  const filePath = getGlobalConfigPath();
  const exists = await fs.pathExists(filePath);
  if (!exists) return null;

  try {
    const content = await fs.readFile(filePath, 'utf8');
    return parseGlobalConfig(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(`读取全局配置失败，已忽略：${message}`);
    return null;
  }
}

/**
 * 将命令行字符串拆解为参数数组（支持引号与转义）。
 */
export function splitCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

function normalizeShortcutArgs(args: string[]): string[] {
  if (args.length > 0 && args[0] === 'run') {
    return args.slice(1);
  }
  return args;
}

/**
 * 应用全局快捷指令，将别名替换为 run 子命令参数。
 */
export function applyShortcutArgv(argv: string[], config: GlobalConfig | null): string[] {
  if (!config?.shortcut) return argv;
  if (argv.length < 3) return argv;
  const commandIndex = 2;
  if (argv[commandIndex] !== config.shortcut.name) return argv;

  const shortcutArgs = normalizeShortcutArgs(splitCommandArgs(config.shortcut.command));
  return [
    ...argv.slice(0, commandIndex),
    'run',
    ...shortcutArgs,
    ...argv.slice(commandIndex + 1)
  ];
}
