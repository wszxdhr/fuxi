import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { buildAutoLogFilePath, formatCommandLine, formatTimeString, getLogMetaPath, getLogsDir, sanitizeBranchName } from '../src/logs';

test('formatTimeString 输出 14 位时间串', () => {
  const date = new Date(2025, 0, 1, 14, 1, 1);
  assert.equal(formatTimeString(date), '20250101140101');
});

test('sanitizeBranchName 会替换非法字符', () => {
  assert.equal(sanitizeBranchName('feature/foo/bar'), 'feature-foo-bar');
  assert.equal(sanitizeBranchName(' fix:bug? '), 'fix-bug');
});

test('buildAutoLogFilePath 会拼接日志目录与分支名', () => {
  const date = new Date(2025, 0, 1, 8, 0, 0);
  const filePath = buildAutoLogFilePath('feat/alpha', date);
  const expected = path.join(getLogsDir(), 'hamster-wheel-cli-auto-log-20250101080000-feat-alpha.log');
  assert.equal(filePath, expected);
});

test('getLogMetaPath 使用同名 json', () => {
  const logFile = path.join('/tmp', 'hamster-wheel-cli-auto-log-20250101140101-main.log');
  const metaPath = getLogMetaPath(logFile);
  const expected = path.join(getLogsDir(), 'hamster-wheel-cli-auto-log-20250101140101-main.json');
  assert.equal(metaPath, expected);
});

test('formatCommandLine 会为包含空格的参数加引号', () => {
  const commandLine = formatCommandLine(['node', 'cli.js', 'run', '--log-file', 'a b']);
  assert.equal(commandLine, 'node cli.js run --log-file "a b"');
});
