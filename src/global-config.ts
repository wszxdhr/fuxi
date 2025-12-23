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
 * 全局配置结构。
 */
export interface GlobalConfig {
  readonly shortcut?: ShortcutConfig;
}

/**
 * 获取全局配置文件路径。
 */
export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.hamster-wheel-cli', 'config.toml');
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

function normalizeShortcutName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed;
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

    const equalIndex = findUnquotedIndex(line, '=');
    if (equalIndex <= 0) continue;

    const key = line.slice(0, equalIndex).trim();
    const valuePart = line.slice(equalIndex + 1).trim();
    if (!key || !valuePart) continue;

    const parsedValue = parseTomlString(valuePart);
    if (parsedValue === null) continue;

    shortcut[key] = parsedValue;
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
