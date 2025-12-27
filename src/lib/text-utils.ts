/**
 * 文本处理工具函数模块
 * 提供常用的文本规范化、截断、解析等工具函数
 */

/**
 * 压缩空白字符，将连续空白替换为单个空格。
 */
export function compactLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 规范化换行符，统一为 \n。
 */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * 从 AI 输出中提取 JSON 内容。
 * 支持代码块包裹和直接 JSON 两种格式。
 */
export function extractJson(text: string): string | null {
  // 尝试匹配代码块包裹的 JSON
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  // 尝试直接提取 JSON 对象
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  return null;
}

/**
 * 截断过长的输出文本。
 */
export function trimOutput(output: string, limit = 4000): string {
  if (!output) return '';
  if (output.length <= limit) return output;
  return `${output.slice(0, limit)}\n……（输出已截断，原始长度 ${output.length} 字符）`;
}

/**
 * 截断文本到指定长度，添加省略号。
 */
export function truncateText(text: string, limit = 100): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}...`;
}

/**
 * 规范化提交信息标题。
 */
export function normalizeCommitTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/**
 * 规范化提交信息正文。
 */
export function normalizeCommitBody(body?: string): string | undefined {
  if (!body) return undefined;
  const normalized = body.replace(/\r\n?/g, '\n').trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * 从记录对象中按优先级提取字符串值。
 */
export function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * 从多行文本中提取列表项（以 - 或 * 开头）。
 */
export function extractBulletLines(text?: string | null): string[] {
  if (!text) return [];
  const lines = normalizeText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const bullets = lines.filter(line => line.startsWith('- ') || line.startsWith('* '));
  return bullets.map(line => (line.startsWith('* ') ? `- ${line.slice(2).trim()}` : line));
}

/**
 * 去除提交类型前缀（如 feat:、fix: 等）。
 */
export function stripCommitType(title: string): string {
  const trimmed = compactLine(title);
  if (!trimmed) return '更新迭代产出';
  const match = trimmed.match(/^[^:]+:\s*(.+)$/);
  return match?.[1]?.trim() || trimmed;
}

/**
 * 从对象中安全提取 packageManager 字段值。
 */
export function extractPackageManagerField(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const field = candidate.packageManager;
  return typeof field === 'string' ? field : undefined;
}

/**
 * 检查对象是否为有效的 JSON 对象。
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从对象中按多个可能的键名提取字符串值。
 */
export function pickStringValue(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}
