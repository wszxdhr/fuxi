import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt } from '../src/ai';

test('buildPrompt 输出包含核心段落与迭代信息', () => {
  const prompt = buildPrompt({
    task: 'demo task',
    workflowGuide: 'workflow guide',
    plan: 'current plan',
    notes: 'historical notes',
    iteration: 2
  });

  assert.ok(prompt.includes('# 背景任务'));
  assert.ok(prompt.includes('demo task'));
  assert.ok(prompt.includes('workflow guide'));
  assert.ok(prompt.includes('current plan'));
  assert.ok(prompt.includes('historical notes'));
  assert.ok(prompt.includes('迭代'));
});
