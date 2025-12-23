import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyShortcutArgv, parseAliasEntries, parseGlobalConfig, splitCommandArgs } from '../src/global-config';

test('parseGlobalConfig 读取 shortcut 配置', () => {
  const content = `
# comment
[shortcut]
name = "daily"
command = "--task \\\"修复 #123\\\" --run-tests" # inline comment
`;
  const config = parseGlobalConfig(content);
  assert.deepEqual(config, {
    shortcut: {
      name: 'daily',
      command: '--task "修复 #123" --run-tests'
    }
  });
});

test('parseGlobalConfig 缺失字段时返回空配置', () => {
  const content = `
[shortcut]
name = "daily run"
`;
  const config = parseGlobalConfig(content);
  assert.deepEqual(config, {});
});

test('splitCommandArgs 支持引号与转义', () => {
  const args = splitCommandArgs('--task "fix bug" --ai-args "--model" "claude-3-opus"');
  assert.deepEqual(args, ['--task', 'fix bug', '--ai-args', '--model', 'claude-3-opus']);
});

test('applyShortcutArgv 展开快捷指令并追加参数', () => {
  const config = parseGlobalConfig(`
[shortcut]
name = "daily"
command = "run --task \\\"demo\\\" --run-tests"
`);
  const argv = ['node', '/path/cli.js', 'daily', '--run-e2e'];
  const result = applyShortcutArgv(argv, config);
  assert.deepEqual(result, [
    'node',
    '/path/cli.js',
    'run',
    '--task',
    'demo',
    '--run-tests',
    '--run-e2e'
  ]);
});

test('parseAliasEntries 读取 alias 并附带 shortcut', () => {
  const content = `
[alias]
daily = "--task \\"补充文档\\""
weekly = "run --task \\"补充测试\\" --run-tests"

[shortcut]
name = "quick"
command = "--run-e2e"
`;
  const entries = parseAliasEntries(content);
  assert.deepEqual(entries, [
    {
      name: 'daily',
      command: '--task "补充文档"',
      source: 'alias'
    },
    {
      name: 'weekly',
      command: 'run --task "补充测试" --run-tests',
      source: 'alias'
    },
    {
      name: 'quick',
      command: '--run-e2e',
      source: 'shortcut'
    }
  ]);
});
