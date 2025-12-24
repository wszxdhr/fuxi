import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyShortcutArgv,
  parseAgentEntries,
  parseAliasEntries,
  parseGlobalConfig,
  removeAgentContent,
  splitCommandArgs,
  updateAgentContent,
  updateAliasContent
} from '../src/global-config';

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

test('updateAliasContent 会在空文件中写入 alias', () => {
  const result = updateAliasContent('', 'daily', '--task "补充文档"');
  assert.ok(result.includes('[alias]'));
  assert.ok(result.includes('daily = "--task \\"补充文档\\""'));
  assert.ok(result.endsWith('\n'));
});

test('updateAliasContent 会更新已有 alias 并保留其他配置', () => {
  const content = `
[alias]
daily = "--task \\"旧命令\\""

[shortcut]
name = "quick"
command = "--run-e2e"
`;
  const result = updateAliasContent(content, 'daily', '--task "新命令"');
  assert.ok(result.includes('daily = "--task \\"新命令\\""'));
  assert.ok(result.includes('[shortcut]'));
});

test('parseAgentEntries 读取 agent 配置', () => {
  const content = `
[agent]
claude = "claude --model sonnet"
`;
  const entries = parseAgentEntries(content);
  assert.deepEqual(entries, [
    {
      name: 'claude',
      command: 'claude --model sonnet'
    }
  ]);
});

test('parseAgentEntries 支持 agents 并忽略重复', () => {
  const content = `
[agents]
daily = "cmd-a"

[agent]
daily = "cmd-b"
weekly = "cmd-c"
`;
  const entries = parseAgentEntries(content);
  assert.deepEqual(entries, [
    {
      name: 'daily',
      command: 'cmd-a'
    },
    {
      name: 'weekly',
      command: 'cmd-c'
    }
  ]);
});

test('updateAgentContent 会在空文件中写入 agent', () => {
  const result = updateAgentContent('', 'daily', 'claude --model sonnet');
  assert.ok(result.includes('[agent]'));
  assert.ok(result.includes('daily = "claude --model sonnet"'));
  assert.ok(result.endsWith('\n'));
});

test('updateAgentContent 会更新已有 agent 并保留其他配置', () => {
  const content = `
[agent]
daily = "cmd-a"

[shortcut]
name = "quick"
command = "--run-e2e"
`;
  const result = updateAgentContent(content, 'daily', 'cmd-b');
  assert.ok(result.includes('daily = "cmd-b"'));
  assert.ok(result.includes('[shortcut]'));
});

test('removeAgentContent 会删除指定 agent', () => {
  const content = `
[agent]
daily = "cmd-a"
weekly = "cmd-b"
`;
  const { removed, nextContent } = removeAgentContent(content, 'daily');
  assert.equal(removed, true);
  assert.ok(!nextContent.includes('daily = "cmd-a"'));
  assert.ok(nextContent.includes('weekly = "cmd-b"'));
});

test('removeAgentContent 未命中时保持原内容', () => {
  const content = `
[agent]
weekly = "cmd-b"
`;
  const { removed, nextContent } = removeAgentContent(content, 'daily');
  assert.equal(removed, false);
  assert.ok(nextContent.includes('weekly = "cmd-b"'));
});
