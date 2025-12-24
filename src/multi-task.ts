import path from 'node:path';

export type MultiTaskMode = 'relay' | 'serial' | 'serial-continue' | 'parallel';

const MODE_ALIASES: Record<string, MultiTaskMode> = {
  relay: 'relay',
  serial: 'serial',
  'serial-continue': 'serial-continue',
  parallel: 'parallel',
  接力模式: 'relay',
  接力: 'relay',
  串行执行: 'serial',
  串行: 'serial',
  串行执行但是失败也继续: 'serial-continue',
  串行继续: 'serial-continue',
  并行执行: 'parallel',
  并行: 'parallel'
};

/**
 * 解析多任务执行模式。
 */
export function parseMultiTaskMode(raw?: string): MultiTaskMode {
  if (!raw) return 'relay';
  const trimmed = raw.trim();
  if (!trimmed) return 'relay';
  const resolved = MODE_ALIASES[trimmed];
  if (!resolved) {
    throw new Error(`未知 multi-task 模式: ${raw}`);
  }
  return resolved;
}

/**
 * 规范化任务列表（去空白、剔除空项）。
 */
export function normalizeTaskList(input: string[] | string | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map(task => task.trim()).filter(task => task.length > 0);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [];
}

export interface TaskPlanInput {
  readonly tasks: string[];
  readonly mode: MultiTaskMode;
  readonly useWorktree: boolean;
  readonly baseBranch: string;
  readonly branchInput?: string;
  readonly worktreePath?: string;
  readonly logFile?: string;
}

export interface TaskPlan {
  readonly task: string;
  readonly index: number;
  readonly branchName?: string;
  readonly baseBranch: string;
  readonly worktreePath?: string;
  readonly logFile?: string;
}

function buildBranchNameSeries(branchInput: string | undefined, total: number): Array<string | undefined> {
  if (total <= 0) return [];
  if (!branchInput) {
    return Array.from({ length: total }, () => undefined);
  }
  const baseName = branchInput;
  const names: Array<string | undefined> = [baseName];
  for (let i = 1; i < total; i += 1) {
    names.push(`${baseName}-${i + 1}`);
  }
  return names;
}

function appendPathSuffix(filePath: string, suffix: string): string {
  const parsed = path.parse(filePath);
  const nextName = parsed.name ? `${parsed.name}-${suffix}` : suffix;
  return path.join(parsed.dir, `${nextName}${parsed.ext}`);
}

function deriveIndexedPath(basePath: string | undefined, index: number, total: number, label: string): string | undefined {
  if (!basePath) return undefined;
  if (total <= 1 || index === 0) return basePath;
  return appendPathSuffix(basePath, `${label}-${index + 1}`);
}

/**
 * 构建多任务执行计划。
 */
export function buildTaskPlans(input: TaskPlanInput): TaskPlan[] {
  const total = input.tasks.length;
  if (total === 0) return [];

  const branchNames: Array<string | undefined> = input.useWorktree
    ? buildBranchNameSeries(input.branchInput, total)
    : input.tasks.map(() => input.branchInput);

  return input.tasks.map((task, index) => {
    const relayBaseBranch = input.useWorktree && input.mode === 'relay' && index > 0
      ? branchNames[index - 1] ?? input.baseBranch
      : input.baseBranch;

    return {
      task,
      index,
      branchName: branchNames[index],
      baseBranch: relayBaseBranch,
      worktreePath: deriveIndexedPath(input.worktreePath, index, total, 'task'),
      logFile: deriveIndexedPath(input.logFile, index, total, 'task')
    };
  });
}
