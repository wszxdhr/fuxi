import path from 'node:path';
import fs from 'fs-extra';
import { Logger } from './logger';
import { runCommand } from './utils';

export type PackageManager = 'yarn' | 'pnpm' | 'npm';

type PackageManagerSource = 'packageManager' | 'lockfile' | 'default';

export interface PackageManagerHints {
  readonly packageManagerField?: string;
  readonly hasYarnLock: boolean;
  readonly hasPnpmLock: boolean;
  readonly hasNpmLock: boolean;
  readonly hasNpmShrinkwrap: boolean;
}

export interface PackageManagerResolution {
  readonly manager: PackageManager;
  readonly source: PackageManagerSource;
  readonly hasLock: boolean;
}

function parsePackageManagerField(value?: string): PackageManager | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yarn' || normalized.startsWith('yarn@')) return 'yarn';
  if (normalized === 'pnpm' || normalized.startsWith('pnpm@')) return 'pnpm';
  if (normalized === 'npm' || normalized.startsWith('npm@')) return 'npm';
  return null;
}

function hasLockForManager(manager: PackageManager, hints: PackageManagerHints): boolean {
  if (manager === 'yarn') return hints.hasYarnLock;
  if (manager === 'pnpm') return hints.hasPnpmLock;
  return hints.hasNpmLock || hints.hasNpmShrinkwrap;
}

export function resolvePackageManager(hints: PackageManagerHints): PackageManagerResolution {
  const fromField = parsePackageManagerField(hints.packageManagerField);
  if (fromField) {
    return {
      manager: fromField,
      source: 'packageManager',
      hasLock: hasLockForManager(fromField, hints)
    };
  }

  if (hints.hasYarnLock) {
    return {
      manager: 'yarn',
      source: 'lockfile',
      hasLock: true
    };
  }
  if (hints.hasPnpmLock) {
    return {
      manager: 'pnpm',
      source: 'lockfile',
      hasLock: true
    };
  }
  if (hints.hasNpmLock || hints.hasNpmShrinkwrap) {
    return {
      manager: 'npm',
      source: 'lockfile',
      hasLock: true
    };
  }

  return {
    manager: 'yarn',
    source: 'default',
    hasLock: false
  };
}

export function buildInstallCommand(resolution: PackageManagerResolution): string {
  switch (resolution.manager) {
    case 'yarn': {
      const args = ['yarn', 'install', '--check-files'];
      if (resolution.hasLock) {
        args.push('--frozen-lockfile');
      } else {
        args.push('--no-lockfile');
      }
      return args.join(' ');
    }
    case 'pnpm': {
      const args = ['pnpm', 'install'];
      if (resolution.hasLock) {
        args.push('--frozen-lockfile');
      }
      return args.join(' ');
    }
    case 'npm': {
      const args = resolution.hasLock ? ['npm', 'ci'] : ['npm', 'install'];
      args.push('--no-audit', '--no-fund');
      return args.join(' ');
    }
    default: {
      return 'yarn install --check-files';
    }
  }
}

function resolveSourceLabel(source: PackageManagerSource): string {
  switch (source) {
    case 'packageManager':
      return 'packageManager 字段';
    case 'lockfile':
      return '锁文件';
    case 'default':
      return '默认策略';
    default:
      return '未知来源';
  }
}

function extractPackageManagerField(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const field = candidate.packageManager;
  return typeof field === 'string' ? field : undefined;
}

async function readPackageManagerHints(cwd: string, logger: Logger): Promise<PackageManagerHints | null> {
  const packageJsonPath = path.join(cwd, 'package.json');
  const hasPackageJson = await fs.pathExists(packageJsonPath);
  if (!hasPackageJson) return null;

  let packageManagerField: string | undefined;
  try {
    const packageJson = await fs.readJson(packageJsonPath);
    packageManagerField = extractPackageManagerField(packageJson);
  } catch (error) {
    logger.warn(`读取 package.json 失败，将改用锁文件判断包管理器: ${String(error)}`);
  }

  const [hasYarnLock, hasPnpmLock, hasNpmLock, hasNpmShrinkwrap] = await Promise.all([
    fs.pathExists(path.join(cwd, 'yarn.lock')),
    fs.pathExists(path.join(cwd, 'pnpm-lock.yaml')),
    fs.pathExists(path.join(cwd, 'package-lock.json')),
    fs.pathExists(path.join(cwd, 'npm-shrinkwrap.json'))
  ]);

  return {
    packageManagerField,
    hasYarnLock,
    hasPnpmLock,
    hasNpmLock,
    hasNpmShrinkwrap
  };
}

export async function ensureDependencies(cwd: string, logger: Logger): Promise<void> {
  const hints = await readPackageManagerHints(cwd, logger);
  if (!hints) {
    logger.info('未检测到 package.json，跳过依赖检查');
    return;
  }

  const resolution = resolvePackageManager(hints);
  const sourceLabel = resolveSourceLabel(resolution.source);
  logger.info(`依赖检查：使用 ${resolution.manager}（来源：${sourceLabel}）`);

  if (resolution.source === 'default') {
    logger.warn('未检测到 packageManager 配置或锁文件，将按默认策略安装依赖');
  }

  const command = buildInstallCommand(resolution);
  logger.info(`开始安装依赖: ${command}`);

  const result = await runCommand('bash', ['-lc', command], {
    cwd,
    logger,
    verboseLabel: 'deps',
    verboseCommand: `bash -lc "${command}"`,
    stream: {
      enabled: true,
      stdoutPrefix: '[deps] ',
      stderrPrefix: '[deps err] '
    }
  });

  if (result.exitCode !== 0) {
    const details = result.stderr || result.stdout || '无输出';
    throw new Error(`依赖安装失败: ${details}`);
  }

  logger.success('依赖检查完成');
}
