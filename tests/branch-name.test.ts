import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBranchName } from '../src/ai';

test('parseBranchName 规范化 JSON 分支名', () => {
  const output = '{"branch":"feat/Add new_feature"}';
  assert.equal(parseBranchName(output), 'feat/add-new-feature');
});

test('parseBranchName 支持类型别名', () => {
  const output = '{"branch":"feature/new-flow"}';
  assert.equal(parseBranchName(output), 'feat/new-flow');
});

test('parseBranchName 支持文本格式', () => {
  const output = '分支名: fix/bug-123';
  assert.equal(parseBranchName(output), 'fix/bug-123');
});

test('parseBranchName 拒绝非法类型', () => {
  const output = '{"branch":"release/prepare"}';
  assert.equal(parseBranchName(output), null);
});

test('parseBranchName 拒绝过短 slug', () => {
  const output = '{"branch":"fix/a"}';
  assert.equal(parseBranchName(output), null);
});
