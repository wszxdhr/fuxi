import path from 'node:path';
import { Logger } from './logger';
import { CommitMessage, WorktreeConfig, WorktreeResult } from './types';
import { runCommand, resolvePath } from './utils';

async function branchExists(branch: string, cwd: string, logger?: Logger): Promise<boolean> {
  const result = await runCommand('git', ['rev-parse', '--verify', branch], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git rev-parse --verify ${branch}`
  });
  return result.exitCode === 0;
}

async function resolveBaseBranch(baseBranch: string, repoRoot: string, logger: Logger): Promise<string> {
  const baseExists = await branchExists(baseBranch, repoRoot, logger);
  if (baseExists) return baseBranch;

  const current = await getCurrentBranch(repoRoot, logger);
  const currentExists = await branchExists(current, repoRoot, logger);
  if (currentExists) {
    logger.warn(`基线分支 ${baseBranch} 不存在，改用当前分支 ${current} 作为基线`);
    return current;
  }

  throw new Error(`基线分支 ${baseBranch} 不存在，且无法确定可用的当前分支`);
}

/**
 * 获取仓库根目录。
 */
export async function getRepoRoot(cwd: string, logger?: Logger): Promise<string> {
  const result = await runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: 'git rev-parse --show-toplevel'
  });
  if (result.exitCode !== 0) {
    throw new Error('当前目录不是 git 仓库，无法继续');
  }
  return result.stdout.trim();
}

/**
 * 获取当前分支名。
 */
export async function getCurrentBranch(cwd: string, logger?: Logger): Promise<string> {
  const result = await runCommand('git', ['branch', '--show-current'], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: 'git branch --show-current'
  });
  if (result.exitCode !== 0) {
    throw new Error(`无法获取当前分支: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function getUpstreamBranch(branchName: string, cwd: string, logger?: Logger): Promise<string | null> {
  const result = await runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branchName}@{u}`], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git rev-parse --abbrev-ref --symbolic-full-name ${branchName}@{u}`
  });
  if (result.exitCode !== 0) {
    logger?.warn(`分支 ${branchName} 没有关联的 upstream: ${result.stderr || result.stdout}`);
    return null;
  }
  return result.stdout.trim();
}

function defaultWorktreePath(repoRoot: string, branchName: string): string {
  return path.join(repoRoot, '..', 'worktrees', branchName);
}

/**
 * 确保目标分支存在。
 */
export async function ensureBranchExists(branchName: string, baseBranch: string, repoRoot: string, logger: Logger): Promise<void> {
  const exists = await branchExists(branchName, repoRoot, logger);
  if (exists) return;
  const create = await runCommand('git', ['branch', branchName, baseBranch], {
    cwd: repoRoot,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git branch ${branchName} ${baseBranch}`
  });
  if (create.exitCode !== 0) {
    throw new Error(`创建分支失败: ${create.stderr}`);
  }
  logger.info(`已基于 ${baseBranch} 创建分支 ${branchName}`);
}

/**
 * 根据配置创建或复用 worktree。
 */
export async function ensureWorktree(config: WorktreeConfig, repoRoot: string, logger: Logger): Promise<WorktreeResult> {
  if (!config.useWorktree) {
    return { path: repoRoot, created: false };
  }

  const branchName = config.branchName ?? generateBranchName();
  const baseBranch = await resolveBaseBranch(config.baseBranch, repoRoot, logger);
  const worktreePath = resolvePath(repoRoot, config.worktreePath ?? defaultWorktreePath(repoRoot, branchName));

  await ensureBranchExists(branchName, baseBranch, repoRoot, logger);

  const addResult = await runCommand('git', ['worktree', 'add', worktreePath, branchName], {
    cwd: repoRoot,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git worktree add ${worktreePath} ${branchName}`
  });
  if (addResult.exitCode !== 0) {
    const alreadyExists = addResult.stderr.includes('already exists') || addResult.stdout.includes('already exists');
    if (alreadyExists) {
      logger.warn(`worktree 路径已存在，跳过创建: ${worktreePath}`);
      return { path: worktreePath, created: false };
    }
    throw new Error(`创建 worktree 失败: ${addResult.stderr || addResult.stdout}`);
  }

  logger.success(`已在 ${worktreePath} 创建并挂载 worktree (${branchName})`);
  return { path: worktreePath, created: true };
}

/**
 * 判断 worktree 是否干净。
 */
export async function isWorktreeClean(cwd: string, logger?: Logger): Promise<boolean> {
  const status = await runCommand('git', ['status', '--porcelain'], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: 'git status --porcelain'
  });
  if (status.exitCode !== 0) {
    logger?.warn(`无法获取 git 状态: ${status.stderr || status.stdout}`);
    return false;
  }
  return status.stdout.trim().length === 0;
}

/**
 * 判断分支是否已推送到远端。
 */
export async function isBranchPushed(branchName: string, cwd: string, logger: Logger): Promise<boolean> {
  const upstream = await getUpstreamBranch(branchName, cwd, logger);
  if (!upstream) return false;

  const countResult = await runCommand('git', ['rev-list', '--left-right', '--count', `${upstream}...${branchName}`], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git rev-list --left-right --count ${upstream}...${branchName}`
  });
  if (countResult.exitCode !== 0) {
    logger.warn(`无法比较分支 ${branchName} 与 ${upstream}: ${countResult.stderr || countResult.stdout}`);
    return false;
  }

  const [behindStr, aheadStr] = countResult.stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadStr ?? '0', 10);
  if (Number.isNaN(ahead)) {
    logger.warn(`无法解析分支推送状态: ${countResult.stdout}`);
    return false;
  }
  if (ahead > 0) {
    logger.warn(`分支 ${branchName} 仍有 ${ahead} 个本地提交未推送`);
    return false;
  }
  return true;
}

function normalizeCommitTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function normalizeCommitBody(body?: string): string | undefined {
  if (!body) return undefined;
  const normalized = body.replace(/\r\n?/g, '\n').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function formatCommitCommand(message: CommitMessage): string {
  const title = normalizeCommitTitle(message.title) || 'chore: 更新迭代产出';
  const parts = ['git commit -m', JSON.stringify(title)];
  const body = normalizeCommitBody(message.body);
  if (body) {
    parts.push('-m', JSON.stringify(body));
  }
  return parts.join(' ');
}

function buildCommitArgs(message: CommitMessage): string[] {
  const title = normalizeCommitTitle(message.title) || 'chore: 更新迭代产出';
  const args = ['commit', '-m', title];
  const body = normalizeCommitBody(message.body);
  if (body) {
    args.push('-m', body);
  }
  return args;
}

/**
 * 提交当前变更。
 */
export async function commitAll(message: CommitMessage, cwd: string, logger: Logger): Promise<void> {
  const add = await runCommand('git', ['add', '-A'], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: 'git add -A'
  });
  if (add.exitCode !== 0) {
    throw new Error(`git add 失败: ${add.stderr}`);
  }
  const commit = await runCommand('git', buildCommitArgs(message), {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: formatCommitCommand(message)
  });
  if (commit.exitCode !== 0) {
    logger.warn(`git commit 跳过或失败: ${commit.stderr}`);
    return;
  }
  logger.success('已提交当前变更');
}

/**
 * 推送分支到远端。
 */
export async function pushBranch(branchName: string, cwd: string, logger: Logger): Promise<void> {
  const push = await runCommand('git', ['push', '-u', 'origin', branchName], {
    cwd,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git push -u origin ${branchName}`
  });
  if (push.exitCode !== 0) {
    throw new Error(`git push 失败: ${push.stderr}`);
  }
  logger.success(`已推送分支 ${branchName}`);
}

/**
 * 删除 worktree 并清理。
 */
export async function removeWorktree(worktreePath: string, repoRoot: string, logger: Logger): Promise<void> {
  const remove = await runCommand('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: repoRoot,
    logger,
    verboseLabel: 'git',
    verboseCommand: `git worktree remove --force ${worktreePath}`
  });
  if (remove.exitCode !== 0) {
    throw new Error(`删除 worktree 失败: ${remove.stderr || remove.stdout}`);
  }

  const prune = await runCommand('git', ['worktree', 'prune'], {
    cwd: repoRoot,
    logger,
    verboseLabel: 'git',
    verboseCommand: 'git worktree prune'
  });
  if (prune.exitCode !== 0) {
    logger.warn(`worktree prune 失败: ${prune.stderr || prune.stdout}`);
  }

  logger.success(`已删除 worktree: ${worktreePath}`);
}

/**
 * 生成默认分支名。
 */
export function generateBranchName(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  return `fuxi/${stamp}`;
}
