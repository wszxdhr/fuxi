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

  assert.ok(stdout.includes('Usage: wheel-ai run'));
  assert.ok(!stdout.includes('--ai-env-file'));
  assert.ok(!stdout.includes('--ai-env'));
  assert.ok(stdout.includes('--log-file'));
  assert.ok(stdout.includes('--background'));
  assert.ok(stdout.includes('--skip-install'));
  assert.ok(stdout.includes('--webhook'));
  assert.ok(stdout.includes('--webhook-timeout'));
  assert.ok(stdout.includes('--multi-task-mode'));
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

  assert.ok(stdout.includes('Usage: wheel-ai monitor'));
  assert.ok(stdout.includes('t 终止任务'));
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

test('CLI logs 帮助信息可正常输出', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'logs', '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('Usage: wheel-ai logs'));
});

test('CLI logs 在非 TTY 下输出提示', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'logs'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('当前终端不支持交互式 logs。'));
});

test('CLI set alias 帮助信息可正常输出', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'set', 'alias', '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('Usage: wheel-ai set alias'));
});

test('CLI alias 帮助信息可正常输出', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'alias', '--help'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('Usage: wheel-ai alias'));
});

test('CLI alias 在非 TTY 下输出提示', async () => {
  const execFileAsync = promisify(execFile);
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const { stdout } = await execFileAsync('node', ['--require', 'ts-node/register', cliPath, 'alias'], {
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    }
  });

  assert.ok(stdout.includes('当前终端不支持交互式 alias。'));
});
