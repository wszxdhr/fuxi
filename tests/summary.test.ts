import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFallbackSummary, ensurePrBodySections, parseDeliverySummary } from '../src/summary';
import type { TestRunResult } from '../src/types';

test('parseDeliverySummary 解析 JSON 输出', () => {
  const output = JSON.stringify({
    commitTitle: 'chore: 更新 PR 文案生成',
    commitBody: '- 优化 PR 标题\n- 补充提交摘要',
    prTitle: 'chore: 更新 PR 文案生成',
    prBody: '# 变更摘要\n- 优化 PR 标题\n\n# 测试结果\n- 未运行\n\n# 风险与回滚\n- 风险：低\n- 回滚：git revert 对应提交'
  });

  const parsed = parseDeliverySummary(output);

  assert.ok(parsed);
  assert.equal(parsed?.commitTitle, 'chore: 更新 PR 文案生成');
  assert.equal(parsed?.prTitle, 'chore: 更新 PR 文案生成');
});

test('parseDeliverySummary 支持 code fence 输出', () => {
  const output = [
    '```json',
    '{"commitTitle":"chore: 文案优化","prTitle":"chore: 文案优化","prBody":"# 变更摘要\\n- 更新\\n\\n# 测试结果\\n- 未运行\\n\\n# 风险与回滚\\n- 风险：待评估","commitBody":"- 更新"}',
    '```'
  ].join('\n');

  const parsed = parseDeliverySummary(output);

  assert.ok(parsed);
  assert.equal(parsed?.commitBody, '- 更新');
});

test('ensurePrBodySections 在缺少标题时使用兜底模板', () => {
  const testResults: TestRunResult[] = [];
  const fallback = {
    commitTitle: 'chore: 补充提交摘要',
    commitBody: '- 调整 PR 文案输出',
    testResults
  };

  const prBody = ensurePrBodySections('简短描述', fallback);

  assert.ok(prBody.includes('# 变更摘要'));
  assert.ok(prBody.includes('# 测试结果'));
  assert.ok(prBody.includes('# 风险与回滚'));
  assert.ok(prBody.includes('- 调整 PR 文案输出'));
});

test('buildFallbackSummary 使用任务生成标题', () => {
  const summary = buildFallbackSummary({
    task: '优化 PR 标题与提交信息生成',
    testResults: null
  });

  assert.ok(summary.prTitle.includes('优化 PR 标题与提交信息生成'));
  assert.ok(summary.prBody.includes('# 变更摘要'));
});
