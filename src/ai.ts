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

function pickNumber(pattern: RegExp, text: string): number | undefined {
  const match = pattern.exec(text);
  if (!match || match.length < 2) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? undefined : value;
}

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

export function mergeTokenUsage(previous: TokenUsage | null, current?: TokenUsage | null): TokenUsage | null {
  if (!current) return previous;
  if (!previous) return { ...current };
  return {
    inputTokens: addOptional(previous.inputTokens, current.inputTokens),
    outputTokens: addOptional(previous.outputTokens, current.outputTokens),
    totalTokens: previous.totalTokens + current.totalTokens
  };
}

export async function runAi(prompt: string, ai: AiCliConfig, logger: Logger, cwd: string): Promise<AiResult> {
  const args = [...ai.args];
  const verboseCommand = ai.promptArg
    ? [ai.command, ...ai.args, ai.promptArg, '<prompt>'].join(' ')
    : [ai.command, ...ai.args, '<stdin>'].join(' ');

  let result;
  if (ai.promptArg) {
    args.push(ai.promptArg, prompt);
    result = await runCommand(ai.command, args, {
      cwd,
      env: ai.env,
      logger,
      verboseLabel: 'ai',
      verboseCommand
    });
  } else {
    result = await runCommand(ai.command, args, {
      cwd,
      env: ai.env,
      input: prompt,
      logger,
      verboseLabel: 'ai',
      verboseCommand
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

export function formatIterationRecord(record: IterationRecord): string {
  const lines = [
    `### 迭代 ${record.iteration} ｜ ${record.timestamp}`,
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
