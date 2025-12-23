import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('CLI 帮助信息可正常输出', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('基于 AI CLI 的持续迭代开发工具'));
  assert.ok(!stdout.includes('--ai-env-file'));
  assert.ok(!stdout.includes('--ai-env'));
});

test('CLI run 帮助信息包含依赖检查选项', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'run', '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('--skip-install'));
});
