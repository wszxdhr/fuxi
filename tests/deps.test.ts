import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInstallCommand, resolvePackageManager } from '../src/deps';

const baseHints = {
  hasYarnLock: false,
  hasPnpmLock: false,
  hasNpmLock: false,
  hasNpmShrinkwrap: false
};

test('resolvePackageManager 优先 packageManager 字段', () => {
  const resolution = resolvePackageManager({
    ...baseHints,
    packageManagerField: 'pnpm@8.0.0',
    hasYarnLock: true,
    hasNpmLock: true
  });

  assert.equal(resolution.manager, 'pnpm');
  assert.equal(resolution.source, 'packageManager');
  assert.equal(resolution.hasLock, false);
});

test('resolvePackageManager 会根据锁文件选择 yarn', () => {
  const resolution = resolvePackageManager({
    ...baseHints,
    hasYarnLock: true
  });

  assert.equal(resolution.manager, 'yarn');
  assert.equal(resolution.source, 'lockfile');
  assert.equal(resolution.hasLock, true);
});

test('resolvePackageManager 无提示时默认使用 yarn', () => {
  const resolution = resolvePackageManager({
    ...baseHints
  });

  assert.equal(resolution.manager, 'yarn');
  assert.equal(resolution.source, 'default');
  assert.equal(resolution.hasLock, false);
});

test('buildInstallCommand 会根据包管理器生成命令', () => {
  const yarnCommand = buildInstallCommand({
    manager: 'yarn',
    source: 'lockfile',
    hasLock: true
  });
  const yarnNoLockCommand = buildInstallCommand({
    manager: 'yarn',
    source: 'default',
    hasLock: false
  });
  const npmCommand = buildInstallCommand({
    manager: 'npm',
    source: 'lockfile',
    hasLock: true
  });
  const pnpmCommand = buildInstallCommand({
    manager: 'pnpm',
    source: 'default',
    hasLock: false
  });

  assert.equal(yarnCommand, 'yarn install --check-files --frozen-lockfile');
  assert.equal(yarnNoLockCommand, 'yarn install --check-files --no-lockfile');
  assert.equal(npmCommand, 'npm ci --no-audit --no-fund');
  assert.equal(pnpmCommand, 'pnpm install');
});
