import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Logger } from '../src/logger';
import { buildWebhookPayload, normalizeWebhookUrls, sendWebhookNotifications, type FetchLike } from '../src/webhook';

test('normalizeWebhookUrls 会去除空值并裁剪空白', () => {
  const urls = normalizeWebhookUrls(['  https://example.com  ', '', '   ', 'http://a.local']);
  assert.deepEqual(urls, ['https://example.com', 'http://a.local']);
});

test('buildWebhookPayload 会补齐本地时间戳', () => {
  const payload = buildWebhookPayload({
    event: 'task_start',
    task: 'demo',
    iteration: 0,
    stage: '任务开始',
    project: 'wheel-ai'
  });
  assert.equal(payload.event, 'task_start');
  assert.equal(payload.task, 'demo');
  assert.equal(payload.iteration, 0);
  assert.match(payload.timestamp, /^\d{8}-\d{6}$/);
  assert.equal(payload.commit, '');
  assert.equal(payload.pr, '');
});

test('sendWebhookNotifications 在无配置时直接跳过', async () => {
  const logger = new Logger({ verbose: false });
  let called = false;
  const fetcher: FetchLike = async () => {
    called = true;
    return { ok: true, status: 200, statusText: 'OK' };
  };

  const payload = buildWebhookPayload({
    event: 'task_start',
    task: 'demo',
    iteration: 0,
    stage: '任务开始',
    project: 'wheel-ai',
    timestamp: '2024-01-01T00:00:00.000Z'
  });

  await sendWebhookNotifications(null, payload, logger, fetcher);
  assert.equal(called, false);
});

test('sendWebhookNotifications 会向多个地址发送', async () => {
  const logger = new Logger({ verbose: false });
  const calls: Array<{ url: string; body: string; contentType: string }> = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: init.body,
      contentType: init.headers['content-type']
    });
    return { ok: true, status: 204, statusText: 'No Content' };
  };

  const payload = buildWebhookPayload({
    event: 'iteration_start',
    branch: 'feat/demo',
    iteration: 2,
    stage: '开始第 2 轮迭代',
    project: 'wheel-ai',
    timestamp: '2024-01-01T00:00:00.000Z'
  });

  await sendWebhookNotifications({ urls: ['https://a.test', 'https://b.test'], timeoutMs: 1000 }, payload, logger, fetcher);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].contentType, 'application/json');
  const decoded = JSON.parse(calls[0].body) as typeof payload;
  assert.equal(decoded.branch, 'feat/demo');
  assert.ok(!('task' in decoded));
});

test('sendWebhookNotifications 捕获异常并不中断', async () => {
  const logger = new Logger({ verbose: false });
  const payload = buildWebhookPayload({
    event: 'task_end',
    iteration: 1,
    stage: '任务结束',
    project: 'wheel-ai',
    timestamp: '2024-01-01T00:00:00.000Z'
  });

  await assert.doesNotReject(async () => {
    await sendWebhookNotifications({ urls: ['https://fail.test'] }, payload, logger, async () => {
      throw new Error('boom');
    });
  });
});
