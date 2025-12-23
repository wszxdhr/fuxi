import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConfirmDialogLines, resolveTerminationTarget } from '../src/monitor';

test('resolveTerminationTarget 在不同平台输出不同目标', () => {
  assert.equal(resolveTerminationTarget(123, 'win32'), 123);
  assert.equal(resolveTerminationTarget(123, 'linux'), -123);
});

test('buildConfirmDialogLines 会生成有限宽度的确认框', () => {
  const lines = buildConfirmDialogLines('alpha.log', 24);
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    assert.ok(line.length <= 24);
  }
  assert.ok(lines.some(line => line.includes('alpha.log')));
});
