import { AiCliConfig, AiResult, IterationRecord, TokenUsage } from './types';
import { runCommand } from './utils';
import { Logger } from './logger';

interface PromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
  readonly iteration: number;
}

/**
 * 构建 AI 提示文本。
 */
export function buildPrompt(input: PromptInput): string {
  const sections = [
    '# 背景任务',
    input.task,
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前持久化计划',
    input.plan || '（暂无计划，首轮请生成可执行计划并写入 plan 文件）',
    '# 历史迭代与记忆',
    input.notes || '（首次执行，暂无历史）',
    '# 本轮执行要求',
    [
      '1. 自我检查并补全需求；明确交付物与验收标准。',
      '2. 更新/细化计划，必要时在 plan 文件中重写任务树与优先级。',
      '3. 设计开发步骤并直接生成代码（无需再次请求确认）。',
      '4. 进行代码自审，给出风险与改进清单。',
      '5. 生成单元测试与 e2e 测试代码并给出运行命令；如果环境允许可直接运行命令。',
      '6. 维护持久化记忆文件：摘要本轮关键结论、遗留问题、下一步建议。',
      '7. 准备提交 PR 所需的标题与描述（含变更摘要、测试结果、风险）。',
      '8. 当所有目标完成时，在输出中加入标记 <<DONE>> 以便外层停止循环。'
    ].join('\n')
  ];

  return sections.join('\n\n');
}

function compactLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface BranchNamePromptInput {
  readonly task: string;
}

/**
 * 构建分支名生成提示。
 */
export function buildBranchNamePrompt(input: BranchNamePromptInput): string {
  return [
    '# 角色',
    '你是资深工程师，需要根据任务生成规范的 git 分支名。',
    '# 规则',
    '- 输出格式仅限严格 JSON（不要 markdown、不要代码块、不要解释）。',
    '- 分支名格式：<type>/<slug>。',
    '- type 可选：feat、fix、docs、refactor、chore、test。',
    '- slug 使用小写英文、数字、连字符，长度 3~40，避免空格与中文。',
    '# 输出 JSON',
    '{"branch":"..."}',
    '# 任务描述',
    compactLine(input.task) || '（空）'
  ].join('\n\n');
}

interface PlanningPromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
  readonly branchName?: string;
}

/**
 * 构建计划生成提示。
 */
export function buildPlanningPrompt(input: PlanningPromptInput): string {
  return [
    '# 背景任务',
    input.task,
    '# 分支信息',
    input.branchName ? `计划使用分支：${input.branchName}` : '未指定分支名，请按任务语义给出建议',
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前计划',
    input.plan || '（暂无计划）',
    '# 历史记忆',
    input.notes || '（暂无历史）',
    '# 本轮执行要求',
    [
      '1. 分析任务输入/输出/约束/验收标准，必要时补充合理假设（写入 notes）。',
      '2. 若 plan.md 已存在，请判断是否合理；合理则不修改，不合理则优化或重写。',
      '3. 计划只包含开发相关任务（设计/实现/重构/配置/文档更新），不要包含测试、自审、PR、提交等内容。',
      '4. 计划项需可执行、颗粒度清晰，已完成项使用 ✅ 标记。',
      '5. 更新 memory/plan.md 与 memory/notes.md 后结束本轮。'
    ].join('\n')
  ].join('\n\n');
}

interface PlanItemPromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
  readonly item: string;
}

/**
 * 构建单条计划执行提示。
 */
export function buildPlanItemPrompt(input: PlanItemPromptInput): string {
  return [
    '# 背景任务',
    input.task,
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前计划',
    input.plan || '（暂无计划）',
    '# 历史记忆',
    input.notes || '（暂无历史）',
    '# 本轮要执行的计划项（仅此一条）',
    input.item,
    '# 本轮执行要求',
    [
      '1. 只执行上述计划项，避免提前处理其它计划项。',
      '2. 完成后立即在 plan.md 中将该项标记为 ✅。',
      '3. 必要时可对计划项进行微调，但仍需确保当前项完成。',
      '4. 本轮不执行测试或质量检查。',
      '5. 将进展、关键改动与风险写入 notes。'
    ].join('\n')
  ].join('\n\n');
}

interface QualityPromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
  readonly commands: string[];
  readonly results?: string;
}

/**
 * 构建质量检查提示。
 */
export function buildQualityPrompt(input: QualityPromptInput): string {
  return [
    '# 背景任务',
    input.task,
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前计划',
    input.plan || '（暂无计划）',
    '# 历史记忆',
    input.notes || '（暂无历史）',
    '# 本轮代码质量检查',
    input.commands.length > 0 ? input.commands.map(cmd => `- ${cmd}`).join('\n') : '未检测到可执行的质量检查命令。',
    input.results ? `# 命令执行结果\n${input.results}` : '',
    '# 本轮执行要求',
    [
      '1. 本轮仅进行代码质量检查，不要修复问题。',
      '2. 若出现失败，记录失败要点，等待下一轮修复。',
      '3. 将结论与风险写入 notes。'
    ].join('\n')
  ].filter(Boolean).join('\n\n');
}

interface FixPromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
  readonly stage: string;
  readonly errors: string;
}

/**
 * 构建问题修复提示（质量检查 / 测试）。
 */
export function buildFixPrompt(input: FixPromptInput): string {
  return [
    '# 背景任务',
    input.task,
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前计划',
    input.plan || '（暂无计划）',
    '# 历史记忆',
    input.notes || '（暂无历史）',
    `# 需要修复的问题（${input.stage}）`,
    input.errors || '（无错误信息）',
    '# 本轮执行要求',
    [
      '1. 聚焦修复当前问题，不要扩展范围。',
      '2. 修复完成后更新 notes，说明修改点与影响。',
      '3. 如需调整计划，请同步更新 plan.md。'
    ].join('\n')
  ].join('\n\n');
}

interface TestPromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
  readonly commands: string[];
  readonly results?: string;
}

/**
 * 构建测试执行提示。
 */
export function buildTestPrompt(input: TestPromptInput): string {
  return [
    '# 背景任务',
    input.task,
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前计划',
    input.plan || '（暂无计划）',
    '# 历史记忆',
    input.notes || '（暂无历史）',
    '# 本轮测试命令',
    input.commands.length > 0 ? input.commands.map(cmd => `- ${cmd}`).join('\n') : '未配置测试命令。',
    input.results ? `# 测试结果\n${input.results}` : '',
    '# 本轮执行要求',
    [
      '1. 本轮仅执行测试，不要修复问题。',
      '2. 若出现失败，记录失败要点，等待下一轮修复。',
      '3. 将测试结论写入 notes。'
    ].join('\n')
  ].filter(Boolean).join('\n\n');
}

interface DocsPromptInput {
  readonly task: string;
  readonly workflowGuide: string;
  readonly plan: string;
  readonly notes: string;
}

/**
 * 构建文档更新提示。
 */
export function buildDocsPrompt(input: DocsPromptInput): string {
  return [
    '# 背景任务',
    input.task,
    '# 工作流程基线（供 AI 自主执行）',
    input.workflowGuide,
    '# 当前计划',
    input.plan || '（暂无计划）',
    '# 历史记忆',
    input.notes || '（暂无历史）',
    '# 本轮执行要求',
    [
      '1. 根据本次改动更新版本号、CHANGELOG、README、docs 等相关文档。',
      '2. 仅更新确有变化的文档，保持中文说明。',
      '3. 将更新摘要写入 notes。'
    ].join('\n')
  ].join('\n\n');
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

const BRANCH_TYPES = ['feat', 'fix', 'docs', 'refactor', 'chore', 'test'] as const;
type BranchType = typeof BRANCH_TYPES[number];

const BRANCH_TYPE_ALIASES: Record<string, BranchType> = {
  feature: 'feat',
  features: 'feat',
  bugfix: 'fix',
  hotfix: 'fix',
  doc: 'docs',
  documentation: 'docs',
  refactoring: 'refactor',
  chores: 'chore',
  tests: 'test'
};

function isBranchType(value: string): value is BranchType {
  return BRANCH_TYPES.includes(value as BranchType);
}

function normalizeBranchType(value: string): BranchType | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (isBranchType(trimmed)) return trimmed;
  return BRANCH_TYPE_ALIASES[trimmed] ?? null;
}

function normalizeBranchSlug(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) return null;
  const trimmed = cleaned.slice(0, 40);
  if (trimmed.length < 3) return null;
  return trimmed;
}

function normalizeBranchNameCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  const parts = lowered.split('/').filter(part => part.length > 0);
  const hasExplicitType = lowered.includes('/') && parts.length >= 2;
  const rawType = hasExplicitType ? parts.shift() ?? '' : '';
  const rawSlug = hasExplicitType ? parts.join('-') : lowered;

  const type = rawType ? normalizeBranchType(rawType) : 'feat';
  if (!type) return null;

  const slug = normalizeBranchSlug(rawSlug);
  if (!slug) return null;

  return `${type}/${slug}`;
}

/**
 * 解析 AI 输出中的分支名。
 */
export function parseBranchName(output: string): string | null {
  const jsonText = extractJson(output);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const raw = typeof parsed.branch === 'string'
        ? parsed.branch
        : typeof parsed.branchName === 'string'
          ? parsed.branchName
          : typeof parsed['分支'] === 'string'
            ? (parsed['分支'] as string)
            : typeof parsed['分支名'] === 'string'
              ? (parsed['分支名'] as string)
              : null;
      if (raw) {
        const normalized = normalizeBranchNameCandidate(raw);
        if (normalized) return normalized;
      }
    } catch {
      // 忽略解析失败，回退到文本匹配
    }
  }

  const lineMatch = output.match(/(?:branch(?:name)?|分支名|分支)\s*[:：]\s*([^\s]+)/i);
  if (lineMatch?.[1]) {
    const normalized = normalizeBranchNameCandidate(lineMatch[1]);
    if (normalized) return normalized;
  }
  return null;
}

function pickNumber(pattern: RegExp, text: string): number | undefined {
  const match = pattern.exec(text);
  if (!match || match.length < 2) return undefined;
  const value = Number.parseInt(match[match.length - 1], 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * 从日志文本中解析 token 使用量。
 */
export function parseTokenUsage(logs: string): TokenUsage | null {
  const total = pickNumber(/total[_\s]tokens:\s*(\d+)/i, logs);
  const input = pickNumber(/(input|prompt)[_\s]tokens:\s*(\d+)/i, logs);
  const output = pickNumber(/(output|completion)[_\s]tokens:\s*(\d+)/i, logs);
  const consumed = pickNumber(/tokens?\s+used:\s*(\d+)/i, logs) ?? pickNumber(/consumed\s+(\d+)\s+tokens?/i, logs);

  const totalTokens = total ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : consumed);
  if (totalTokens === undefined) return null;

  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens
  };
}

function addOptional(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number' && typeof b !== 'number') return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * 合并多轮 token 统计。
 */
export function mergeTokenUsage(previous: TokenUsage | null, current?: TokenUsage | null): TokenUsage | null {
  if (!current) return previous;
  if (!previous) return { ...current };
  return {
    inputTokens: addOptional(previous.inputTokens, current.inputTokens),
    outputTokens: addOptional(previous.outputTokens, current.outputTokens),
    totalTokens: previous.totalTokens + current.totalTokens
  };
}

/**
 * 调用 AI CLI 并返回输出。
 */
export async function runAi(prompt: string, ai: AiCliConfig, logger: Logger, cwd: string): Promise<AiResult> {
  const args = [...ai.args];
  const verboseCommand = ai.promptArg
    ? [ai.command, ...ai.args, ai.promptArg, '<prompt>'].join(' ')
    : [ai.command, ...ai.args, '<stdin>'].join(' ');
  const streamPrefix = `[${ai.command}] `;
  const streamErrorPrefix = `[${ai.command} stderr] `;

  let result;
  if (ai.promptArg) {
    args.push(ai.promptArg, prompt);
    result = await runCommand(ai.command, args, {
      cwd,
      logger,
      verboseLabel: 'ai',
      verboseCommand,
      stream: {
        enabled: true,
        stdoutPrefix: streamPrefix,
        stderrPrefix: streamErrorPrefix
      }
    });
  } else {
    result = await runCommand(ai.command, args, {
      cwd,
      input: prompt,
      logger,
      verboseLabel: 'ai',
      verboseCommand,
      stream: {
        enabled: true,
        stdoutPrefix: streamPrefix,
        stderrPrefix: streamErrorPrefix
      }
    });
  }

  if (result.exitCode !== 0) {
    throw new Error(`AI CLI 执行失败: ${result.stderr || result.stdout}`);
  }

  logger.success('AI 输出完成');
  const usage = parseTokenUsage([result.stdout, result.stderr].filter(Boolean).join('\n'));
  return {
    output: result.stdout.trim(),
    usage
  };
}

/**
 * 生成 notes 迭代记录文本。
 */
export function formatIterationRecord(record: IterationRecord): string {
  const title = record.stage
    ? `### 迭代 ${record.iteration} ｜ ${record.timestamp} ｜ ${record.stage}`
    : `### 迭代 ${record.iteration} ｜ ${record.timestamp}`;
  const lines = [
    title,
    '',
    '#### 提示上下文',
    '```',
    record.prompt,
    '```',
    '',
    '#### AI 输出',
    '```',
    record.aiOutput,
    '```',
    ''
  ];

  if (record.checkResults && record.checkResults.length > 0) {
    lines.push('#### 质量检查结果');
    record.checkResults.forEach(result => {
      const status = result.success ? '✅ 通过' : '❌ 失败';
      lines.push(`${status} ｜ ${result.name} ｜ 命令: ${result.command} ｜ 退出码: ${result.exitCode}`);
      if (!result.success) {
        lines.push('```');
        lines.push(result.stderr || result.stdout || '（无输出）');
        lines.push('```');
        lines.push('');
      }
    });
  }

  if (record.testResults && record.testResults.length > 0) {
    lines.push('#### 测试结果');
    record.testResults.forEach(result => {
      const label = result.kind === 'unit' ? '单元测试' : 'e2e 测试';
      const status = result.success ? '✅ 通过' : '❌ 失败';
      lines.push(`${status} ｜ ${label} ｜ 命令: ${result.command} ｜ 退出码: ${result.exitCode}`);
      if (!result.success) {
        lines.push('```');
        lines.push(result.stderr || result.stdout || '（无输出）');
        lines.push('```');
        lines.push('');
      }
    });
  }

  return lines.join('\n');
}
