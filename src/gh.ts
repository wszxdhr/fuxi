import { Logger } from './logger';
import { PrConfig } from './types';
import { runCommand } from './utils';

/**
 * PR 基础信息。
 */
export interface GhPrInfo {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: string;
  readonly headRefName: string;
}

/**
 * Actions 运行信息。
 */
export interface GhRunInfo {
  readonly databaseId: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion?: string | null;
  readonly url: string;
}

function isGhPrInfo(input: unknown): input is GhPrInfo {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Record<string, unknown>;
  return typeof candidate.number === 'number'
    && typeof candidate.url === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.state === 'string'
    && typeof candidate.headRefName === 'string';
}

function resolveRunDatabaseId(candidate: Record<string, unknown>): number | null {
  const databaseId = candidate.databaseId;
  if (typeof databaseId === 'number' && Number.isFinite(databaseId)) return databaseId;
  const id = candidate.id;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string') {
    const parsed = Number(id);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseGhRunInfo(input: unknown): GhRunInfo | null {
  if (typeof input !== 'object' || input === null) return null;
  const candidate = input as Record<string, unknown>;
  const databaseId = resolveRunDatabaseId(candidate);
  if (databaseId === null) return null;
  if (typeof candidate.name !== 'string') return null;
  if (typeof candidate.status !== 'string') return null;
  if (typeof candidate.url !== 'string') return null;
  const conclusion = candidate.conclusion;
  const hasValidConclusion = conclusion === undefined || conclusion === null || typeof conclusion === 'string';
  if (!hasValidConclusion) return null;
  return {
    databaseId,
    name: candidate.name,
    status: candidate.status,
    conclusion: conclusion ?? null,
    url: candidate.url
  };
}

/**
 * 解析 gh run list 的 JSON 输出。
 */
export function parseGhRunList(output: string): GhRunInfo[] {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseGhRunInfo)
      .filter((run): run is GhRunInfo => run !== null);
  } catch {
    return [];
  }
}

/**
 * 解析 PR 标题，必要时给出兜底标题。
 */
export function resolvePrTitle(branch: string, title?: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return `chore: 自动 PR (${branch})`;
}

/**
 * 组装 gh pr create 所需参数。
 */
export function buildPrCreateArgs(branch: string, config: PrConfig): string[] {
  const args = ['pr', 'create', '--head', branch, '--title', resolvePrTitle(branch, config.title)];
  if (config.bodyPath) {
    args.push('--body-file', config.bodyPath);
  } else {
    args.push('--body', '自动生成 PR（未提供 body 文件）');
  }
  if (config.draft) {
    args.push('--draft');
  }
  if (config.reviewers && config.reviewers.length > 0) {
    args.push('--reviewer', config.reviewers.join(','));
  }
  return args;
}

/**
 * 读取当前分支 PR 信息。
 */
export async function viewPr(branch: string, cwd: string, logger: Logger): Promise<GhPrInfo | null> {
  const result = await runCommand('gh', ['pr', 'view', branch, '--json', 'number,title,url,state,headRefName'], {
    cwd,
    logger,
    verboseLabel: 'gh',
    verboseCommand: `gh pr view ${branch} --json number,title,url,state,headRefName`
  });
  if (result.exitCode !== 0) {
    logger.warn(`gh pr view 失败: ${result.stderr}`);
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (isGhPrInfo(parsed)) return parsed;
    logger.warn('gh pr view 返回格式异常');
    return null;
  } catch (error) {
    logger.warn(`解析 gh pr view 输出失败: ${String(error)}`);
    return null;
  }
}

/**
 * 创建 PR 并返回 PR 信息。
 */
export async function createPr(branch: string, config: PrConfig, cwd: string, logger: Logger): Promise<GhPrInfo | null> {
  if (!config.enable) return null;
  const args = buildPrCreateArgs(branch, config);

  const result = await runCommand('gh', args, {
    cwd,
    logger,
    verboseLabel: 'gh',
    verboseCommand: `gh ${args.join(' ')}`
  });
  if (result.exitCode !== 0) {
    logger.warn(`创建 PR 失败: ${result.stderr || result.stdout}`);
    return null;
  }

  return viewPr(branch, cwd, logger);
}

/**
 * 获取最近失败的 Actions 运行。
 */
export async function listFailedRuns(branch: string, cwd: string, logger: Logger): Promise<GhRunInfo[]> {
  const result = await runCommand('gh', ['run', 'list', '--branch', branch, '--json', 'databaseId,name,status,conclusion,url', '--limit', '5'], {
    cwd,
    logger,
    verboseLabel: 'gh',
    verboseCommand: `gh run list --branch ${branch} --json databaseId,name,status,conclusion,url --limit 5`
  });
  if (result.exitCode !== 0) {
    logger.warn(`获取 Actions 运行失败: ${result.stderr}`);
    return [];
  }
  try {
    const runs = parseGhRunList(result.stdout);
    const failed = runs.filter(run => run.conclusion && run.conclusion !== 'success');
    if (failed.length === 0) {
      logger.info('最近 5 次 Actions 运行无失败');
    }
    return failed;
  } catch (error) {
    logger.warn(`解析 Actions 输出失败: ${String(error)}`);
    return [];
  }
}
