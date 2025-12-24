import { Logger } from './logger';
import { localTimestamp } from './utils';
import type { WebhookConfig } from './types';

export type WebhookEvent = 'task_start' | 'iteration_start' | 'task_end';

export interface WebhookPayloadBase {
  readonly event: WebhookEvent;
  readonly branch: string;
  readonly iteration: number;
  readonly stage: string;
  readonly timestamp: string;
  readonly project: string;
  readonly commit: string;
  readonly pr: string;
}

export type WebhookPayload =
  | (WebhookPayloadBase & {
      readonly event: 'task_start';
      readonly task: string;
    })
  | (WebhookPayloadBase & {
      readonly event: 'iteration_start' | 'task_end';
    });

export interface WebhookPayloadInputBase {
  readonly event: WebhookEvent;
  readonly branch?: string;
  readonly iteration: number;
  readonly stage: string;
  readonly timestamp?: string;
  readonly project: string;
  readonly commit?: string;
  readonly pr?: string;
}

export type WebhookPayloadInput =
  | (WebhookPayloadInputBase & {
      readonly event: 'task_start';
      readonly task: string;
    })
  | (WebhookPayloadInputBase & {
      readonly event: 'iteration_start' | 'task_end';
    });

export type FetchLikeResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
};

export type FetchLike = (url: string, init: {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal?: AbortSignal;
}) => Promise<FetchLikeResponse>;

const DEFAULT_TIMEOUT_MS = 8000;

export function normalizeWebhookUrls(urls?: string[]): string[] {
  if (!urls || urls.length === 0) return [];
  return urls
    .map(url => url.trim())
    .filter(url => url.length > 0);
}

export function buildWebhookPayload(input: WebhookPayloadInput): WebhookPayload {
  const base = {
    branch: input.branch ?? '',
    iteration: input.iteration,
    stage: input.stage,
    timestamp: input.timestamp ?? localTimestamp(),
    project: input.project,
    commit: input.commit ?? '',
    pr: input.pr ?? ''
  };

  if (input.event === 'task_start') {
    return {
      ...base,
      event: 'task_start',
      task: input.task
    };
  }

  return {
    ...base,
    event: input.event
  };
}

function resolveFetcher(fetcher?: FetchLike): FetchLike | null {
  if (fetcher) return fetcher;
  const globalFetcher = globalThis.fetch;
  if (typeof globalFetcher !== 'function') return null;
  return (globalFetcher as typeof fetch) as FetchLike;
}

async function postWebhook(url: string, payload: WebhookPayload, timeoutMs: number, logger: Logger, fetcher: FetchLike): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      logger.warn(`webhook 请求失败（${response.status} ${response.statusText}）：${url}`);
    } else {
      logger.debug(`webhook 通知成功：${url}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`webhook 通知异常：${url}｜${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWebhookNotifications(
  config: WebhookConfig | null | undefined,
  payload: WebhookPayload,
  logger: Logger,
  fetcher?: FetchLike
): Promise<void> {
  const urls = normalizeWebhookUrls(config?.urls);
  if (urls.length === 0) return;

  const resolvedFetcher = resolveFetcher(fetcher);
  if (!resolvedFetcher) {
    logger.warn('当前 Node 环境不支持 fetch，已跳过 webhook 通知');
    return;
  }

  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  await Promise.all(urls.map(url => postWebhook(url, payload, timeoutMs, logger, resolvedFetcher)));
}
