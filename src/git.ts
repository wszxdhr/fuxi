import path from 'node:path';
import { Logger } from './logger';
import { WorktreeConfig } from './types';
import { runCommand, resolvePath } from './utils';

async function branchExists(branch: string, cwd: string): Promise<boolean> {
  const result = await runCommand('git', ['rev-parse', '--verify', branch], { cwd });
  return result.exitCode === 0;
}

export async function getRepoRoot(cwd: string): Promise<string> {
  const result = await runCommand('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (result.exitCode !== 0) {
    throw new Error('当前目录不是 git 仓库，无法继续');
  }
  return result.stdout.trim();
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await runCommand('git', ['branch', '--show-current'], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`无法获取当前分支: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function defaultWorktreePath(repoRoot: string, branchName: string): string {
  return path.join(repoRoot, '..', 'worktrees', branchName);
}

export async function ensureBranchExists(branchName: string, baseBranch: string, repoRoot: string, logger: Logger): Promise<void> {
  const exists = await branchExists(branchName, repoRoot);
  if (exists) return;
  const create = await runCommand('git', ['branch', branchName, baseBranch], { cwd: repoRoot });
  if (create.exitCode !== 0) {
    throw new Error(`创建分支失败: ${create.stderr}`);
  }
  logger.info(`已基于 ${baseBranch} 创建分支 ${branchName}`);
}

export async function ensureWorktree(config: WorktreeConfig, repoRoot: string, logger: Logger): Promise<string> {
  if (!config.useWorktree) {
    return repoRoot;
  }

  const branchName = config.branchName ?? generateBranchName();
  const worktreePath = resolvePath(repoRoot, config.worktreePath ?? defaultWorktreePath(repoRoot, branchName));

  await ensureBranchExists(branchName, config.baseBranch, repoRoot, logger);

  const addResult = await runCommand('git', ['worktree', 'add', worktreePath, branchName], { cwd: repoRoot });
  if (addResult.exitCode !== 0) {
    if (addResult.stderr.includes('already exists')) {
      logger.warn(`worktree 路径已存在，跳过创建: ${worktreePath}`);
      return worktreePath;
    }
    throw new Error(`创建 worktree 失败: ${addResult.stderr}`);
  }

  logger.success(`已在 ${worktreePath} 创建并挂载 worktree (${branchName})`);
  return worktreePath;
}

export async function commitAll(message: string, cwd: string, logger: Logger): Promise<void> {
  const add = await runCommand('git', ['add', '-A'], { cwd });
  if (add.exitCode !== 0) {
    throw new Error(`git add 失败: ${add.stderr}`);
  }
  const commit = await runCommand('git', ['commit', '-m', message], { cwd });
  if (commit.exitCode !== 0) {
    logger.warn(`git commit 跳过或失败: ${commit.stderr}`);
    return;
  }
  logger.success('已提交当前变更');
}

export async function pushBranch(branchName: string, cwd: string, logger: Logger): Promise<void> {
  const push = await runCommand('git', ['push', '-u', 'origin', branchName], { cwd });
  if (push.exitCode !== 0) {
    throw new Error(`git push 失败: ${push.stderr}`);
  }
  logger.success(`已推送分支 ${branchName}`);
}

export function generateBranchName(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  return `fuxi/${stamp}`;
}
