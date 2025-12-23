import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('CLI 帮助信息可正常输出', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'run', '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('Usage: hamster-wheel-cli run'));
  assert.ok(!stdout.includes('--ai-env-file'));
  assert.ok(!stdout.includes('--ai-env'));
  assert.ok(stdout.includes('--log-file'));
  assert.ok(stdout.includes('--background'));
  assert.ok(stdout.includes('--skip-install'));
});

test('CLI monitor 帮助信息可正常输出', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'monitor', '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('Usage: hamster-wheel-cli monitor'));
});

test('CLI monitor 在非 TTY 下输出提示', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'monitor'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('当前终端不支持交互式 monitor。'));
});
