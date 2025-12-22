import { Logger } from './logger';
import { PrConfig } from './types';
import { runCommand } from './utils';

export interface GhPrInfo {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: string;
  readonly headRefName: string;
}

export interface GhRunInfo {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion?: string;
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

function isGhRunInfo(input: unknown): input is GhRunInfo {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Record<string, unknown>;
  return typeof candidate.id === 'number'
    && typeof candidate.name === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.url === 'string';
}

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

export async function createPr(branch: string, config: PrConfig, cwd: string, logger: Logger): Promise<GhPrInfo | null> {
  if (!config.enable) return null;
  const args = ['pr', 'create', '--head', branch];
  if (config.title) {
    args.push('--title', config.title);
  }
  if (config.bodyPath) {
    args.push('--body-file', config.bodyPath);
  }
  if (config.draft) {
    args.push('--draft');
  }
  if (config.reviewers && config.reviewers.length > 0) {
    args.push('--reviewer', config.reviewers.join(','));
  }

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
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    const runs: GhRunInfo[] = parsed
      .filter(isGhRunInfo)
      .map(run => ({ ...run, conclusion: run.conclusion }));
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
