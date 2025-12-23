import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pad2 } from '../src/utils';

test('pad2 会补齐两位数字', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(12), '12');
});
