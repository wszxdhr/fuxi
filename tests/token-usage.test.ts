import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeTokenUsage, parseTokenUsage } from '../src/ai';

test('parseTokenUsage 可解析 total_tokens 行', () => {
  const logs = 'model: demo\nTotal_tokens: 321\n';
  const usage = parseTokenUsage(logs);

  assert.ok(usage);
  assert.equal(usage?.totalTokens, 321);
});

test('parseTokenUsage 可累加 prompt/output tokens', () => {
  const logs = 'prompt_tokens: 120\ncompletion_tokens: 30\n';
  const usage = parseTokenUsage(logs);

  assert.ok(usage);
  assert.equal(usage?.totalTokens, 150);
  assert.equal(usage?.inputTokens, 120);
  assert.equal(usage?.outputTokens, 30);
});

test('mergeTokenUsage 会累计各轮数据', () => {
  const merged = mergeTokenUsage(
    { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    { inputTokens: 5, outputTokens: 10, totalTokens: 15 }
  );

  assert.ok(merged);
  assert.equal(merged?.totalTokens, 45);
  assert.equal(merged?.inputTokens, 15);
  assert.equal(merged?.outputTokens, 30);
});
