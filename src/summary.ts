import { DeliverySummary, TestRunResult } from './types';

export interface SummaryPromptInput {
  readonly task: string;
  readonly plan: string;
  readonly notes: string;
  readonly lastAiOutput: string;
  readonly testResults: TestRunResult[] | null;
  readonly gitStatus: string;
  readonly diffStat: string;
  readonly branchName?: string;
}

export interface SummaryFallbackInput {
  readonly task: string;
  readonly testResults: TestRunResult[] | null;
}

export interface PrBodyFallbackInput {
  readonly commitTitle: string;
  readonly commitBody?: string;
  readonly testResults: TestRunResult[] | null;
}

const REQUIRED_SECTIONS = ['# 变更摘要', '# 测试结果', '# 风险与回滚'] as const;

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function compactLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function trimTail(text: string, limit: number, emptyFallback: string): string {
  const normalized = normalizeText(text).trim();
  if (!normalized) return emptyFallback;
  if (normalized.length <= limit) return normalized;
  return `（内容过长，保留最后 ${limit} 字符）\n${normalized.slice(-limit)}`;
}

function formatTestResultLines(testResults: TestRunResult[] | null): string[] {
  if (!testResults || testResults.length === 0) {
    return ['- 未运行（本次未执行测试）'];
  }
  return testResults.map(result => {
    const label = result.kind === 'unit' ? '单元测试' : 'e2e 测试';
    const status = result.success ? '通过' : `失败（退出码 ${result.exitCode}）`;
    const command = result.command ? `｜命令: ${result.command}` : '';
    return `- ${label}: ${status} ${command}`.trim();
  });
}

function formatTestResultsForPrompt(testResults: TestRunResult[] | null): string {
  return formatTestResultLines(testResults).join('\n');
}

function buildSummaryLinesFromCommit(commitTitle: string, commitBody?: string): string[] {
  const bulletLines = extractBulletLines(commitBody);
  if (bulletLines.length > 0) return bulletLines;
  const summary = stripCommitType(commitTitle);
  return [`- ${summary}`];
}

function stripCommitType(title: string): string {
  const trimmed = compactLine(title);
  if (!trimmed) return '更新迭代产出';
  const match = trimmed.match(/^[^:]+:\s*(.+)$/);
  return match?.[1]?.trim() || trimmed;
}

function buildPrBody(summaryLines: string[], testLines: string[]): string {
  const riskLines = ['- 风险：待评估', '- 回滚：git revert 对应提交或关闭 PR'];
  return [
    '# 变更摘要',
    summaryLines.join('\n'),
    '',
    '# 测试结果',
    testLines.join('\n'),
    '',
    '# 风险与回滚',
    riskLines.join('\n')
  ].join('\n');
}

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const planSnippet = trimTail(input.plan, 2000, '（计划为空）');
  const notesSnippet = trimTail(input.notes, 4000, '（notes 为空）');
  const aiSnippet = trimTail(input.lastAiOutput, 3000, '（本轮无 AI 输出）');
  const statusSnippet = trimTail(input.gitStatus, 1000, '（git status 为空）');
  const diffSnippet = trimTail(input.diffStat, 1000, '（diff 统计为空）');
  const testSummary = formatTestResultsForPrompt(input.testResults);

  return [
    '# 角色',
    '你是资深工程师，需要为本次迭代生成提交信息与 PR 文案。',
    '# 任务',
    '基于输入信息输出严格 JSON（不要 markdown、不要代码块、不要多余文字）。',
    '要求：',
    '- 全部中文。',
    '- commitTitle / prTitle 使用 Conventional Commits 格式：<type>: <概要>，简洁具体，不要出现“自动迭代提交/自动 PR”等字样。',
    '- commitBody 为多行要点列表（可为空字符串）。',
    '- prBody 为 Markdown，必须包含标题：# 变更摘要、# 测试结果、# 风险与回滚，并在变更摘要中体现工作总结。',
    '- 不确定处可基于现有信息合理推断，但不要编造测试结果。',
    '# 输出 JSON',
    '{"commitTitle":"...","commitBody":"...","prTitle":"...","prBody":"..."}',
    '# 输入信息',
    `任务: ${compactLine(input.task) || '（空）'}`,
    `分支: ${input.branchName ?? '（未知）'}`,
    '计划（节选）:',
    planSnippet,
    'notes（节选）:',
    notesSnippet,
    '最近一次 AI 输出（节选）:',
    aiSnippet,
    '测试结果:',
    testSummary,
    'git status --short:',
    statusSnippet,
    'git diff --stat:',
    diffSnippet
  ].join('\n\n');
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return null;
}

function normalizeTitle(title: string): string {
  return compactLine(title);
}

function normalizeBody(body?: string | null): string | undefined {
  if (!body) return undefined;
  const normalized = normalizeText(body).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractBulletLines(text?: string | null): string[] {
  if (!text) return [];
  const lines = normalizeText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const bullets = lines.filter(line => line.startsWith('- ') || line.startsWith('* '));
  return bullets.map(line => (line.startsWith('* ') ? `- ${line.slice(2).trim()}` : line));
}

export function parseDeliverySummary(output: string): DeliverySummary | null {
  const jsonText = extractJson(output);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    let commitTitle = pickString(parsed, ['commitTitle', 'commit_message', 'commitMessage', 'commit_title']);
    let commitBody = pickString(parsed, ['commitBody', 'commit_body']);
    let prTitle = pickString(parsed, ['prTitle', 'pr_title']);
    let prBody = pickString(parsed, ['prBody', 'pr_body']);

    const commitObj = parsed.commit;
    if ((!commitTitle || !commitBody) && typeof commitObj === 'object' && commitObj !== null) {
      const commitRecord = commitObj as Record<string, unknown>;
      commitTitle = commitTitle ?? pickString(commitRecord, ['title', 'commitTitle']);
      commitBody = commitBody ?? pickString(commitRecord, ['body', 'commitBody']);
    }

    const prObj = parsed.pr;
    if ((!prTitle || !prBody) && typeof prObj === 'object' && prObj !== null) {
      const prRecord = prObj as Record<string, unknown>;
      prTitle = prTitle ?? pickString(prRecord, ['title', 'prTitle']);
      prBody = prBody ?? pickString(prRecord, ['body', 'prBody']);
    }

    if (!commitTitle || !prTitle || !prBody) return null;

    const normalizedCommitTitle = normalizeTitle(commitTitle);
    const normalizedPrTitle = normalizeTitle(prTitle);
    const normalizedCommitBody = normalizeBody(commitBody);
    const normalizedPrBody = normalizeText(prBody).trim();

    if (!normalizedCommitTitle || !normalizedPrTitle || !normalizedPrBody) return null;

    return {
      commitTitle: normalizedCommitTitle,
      commitBody: normalizedCommitBody,
      prTitle: normalizedPrTitle,
      prBody: normalizedPrBody
    };
  } catch {
    return null;
  }
}

export function buildFallbackSummary(input: SummaryFallbackInput): DeliverySummary {
  const taskLine = compactLine(input.task);
  const shortTask = taskLine.length > 50 ? `${taskLine.slice(0, 50)}...` : taskLine;
  const baseTitle = shortTask || '更新迭代产出';
  const title = `chore: ${baseTitle}`;
  const summaryLines = [`- ${baseTitle}`];
  const testLines = formatTestResultLines(input.testResults);
  const prBody = buildPrBody(summaryLines, testLines);
  return {
    commitTitle: title,
    commitBody: summaryLines.join('\n'),
    prTitle: title,
    prBody
  };
}

export function ensurePrBodySections(prBody: string, fallback: PrBodyFallbackInput): string {
  const normalized = normalizeText(prBody).trim();
  const hasAll = REQUIRED_SECTIONS.every(section => normalized.includes(section));
  if (hasAll) return normalized;

  const summaryLines = buildSummaryLinesFromCommit(fallback.commitTitle, fallback.commitBody);
  const testLines = formatTestResultLines(fallback.testResults);
  return buildPrBody(summaryLines, testLines);
}
