/**
 * TOML 解析工具模块
 * 提供轻量级的 TOML 文件解析功能，用于全局配置文件
 */

/**
 * 去除 TOML 行注释（支持 # 和 ;）。
 * 正确处理字符串内的注释符号和转义字符。
 */
export function stripTomlComment(line: string): string {
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      // 双引号字符串支持转义
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

    // 非引号内的 # 或 ; 是注释符号
    if (char === '#' || char === ';') {
      return line.slice(0, i);
    }
  }

  return line;
}

/**
 * 在未加引号的文本中查找指定字符的位置。
 */
export function findUnquotedIndex(text: string, target: string): number {
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

/**
 * 解析 TOML 字符串值（支持转义字符）。
 */
export function parseTomlString(raw: string): string | null {
  const value = raw.trim();
  if (value.length < 2) return null;

  const quote = value[0];
  if (quote !== '"' && quote !== '\'') return null;

  let result = '';
  let escaped = false;

  for (let i = 1; i < value.length; i += 1) {
    const char = value[i];

    if (quote === '"') {
      // 双引号字符串支持转义
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

    // 单引号字符串不支持转义
    if (char === quote) {
      const rest = value.slice(i + 1).trim();
      if (rest.length > 0) return null;
      return result;
    }

    result += char;
  }

  return null;
}

/**
 * 解析 TOML 键值对行。
 */
export function parseTomlKeyValue(line: string): { key: string; value: string } | null {
  const equalIndex = findUnquotedIndex(line, '=');
  if (equalIndex <= 0) return null;

  const key = line.slice(0, equalIndex).trim();
  const valuePart = line.slice(equalIndex + 1).trim();

  if (!key || !valuePart) return null;

  const parsedValue = parseTomlString(valuePart);
  if (parsedValue === null) return null;

  return { key, value: parsedValue };
}

/**
 * 将字符串值格式化为 TOML 字符串（转义特殊字符）。
 */
export function formatTomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * TOML 区块范围信息。
 */
export interface TomlSectionRange {
  readonly name: string;
  readonly start: number;
  end: number;
}

/**
 * 收集 TOML 文件中所有的区块范围。
 */
export function collectSectionRanges(lines: string[]): TomlSectionRange[] {
  const ranges: TomlSectionRange[] = [];
  let current: TomlSectionRange | null = null;

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

/**
 * 确保文本以换行符结尾。
 */
export function ensureTrailingNewline(content: string): string {
  if (!content) return '';
  return content.endsWith('\n') ? content : `${content}\n`;
}

/**
 * 规范化快捷指令/alias/agent 名称。
 */
export function normalizeConfigName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 检查区块名称是否为 agent 相关区块。
 */
export function isAgentSection(name: string | null): boolean {
  return name === 'agent' || name === 'agents';
}
