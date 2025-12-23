import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrCreateArgs, isPrAlreadyExistsMessage, resolvePrTitle } from '../src/gh';
import type { PrConfig } from '../src/types';

test('resolvePrTitle 在未提供标题时生成默认标题', () => {
  const title = resolvePrTitle('feat/demo', '   ');

  assert.equal(title, 'chore: 自动 PR (feat/demo)');
});

test('buildPrCreateArgs 始终包含 --title 与 --body 参数', () => {
  const config: PrConfig = {
    enable: true,
    draft: false,
    reviewers: []
  };
  const args = buildPrCreateArgs('feat/demo', config);

  const titleIndex = args.indexOf('--title');
  const bodyIndex = args.indexOf('--body');

  assert.ok(titleIndex >= 0, '应包含 --title');
  assert.ok(bodyIndex >= 0, '应包含 --body');
  assert.equal(args[titleIndex + 1], 'chore: 自动 PR (feat/demo)');
});

test('buildPrCreateArgs 支持使用 body 文件', () => {
  const config: PrConfig = {
    enable: true,
    title: 'chore: ready',
    bodyPath: 'memory/pr-body.md',
    draft: true,
    reviewers: ['alice', 'bob']
  };
  const args = buildPrCreateArgs('feat/demo', config);

  assert.ok(args.includes('--body-file'));
  assert.ok(args.includes('memory/pr-body.md'));
  assert.ok(args.includes('--draft'));
  assert.ok(args.includes('--reviewer'));
  assert.ok(args.includes('alice,bob'));
});

test('isPrAlreadyExistsMessage 可识别已有 PR 提示', () => {
  assert.equal(
    isPrAlreadyExistsMessage('a pull request for branch "feat/demo" into branch "main" already exists'),
    true
  );
  assert.equal(isPrAlreadyExistsMessage('A PR already exists for branch feat/demo on branch main'), true);
  assert.equal(isPrAlreadyExistsMessage('针对分支 feat/demo 到分支 main 的拉取请求已存在'), true);
  assert.equal(isPrAlreadyExistsMessage('分支 feat/demo 已存在 PR，无法重复创建'), true);
  assert.equal(isPrAlreadyExistsMessage('The draft already exists for PR #123'), false);
  assert.equal(isPrAlreadyExistsMessage('some other error'), false);
});
