import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Logger } from '../src/logger';

type ConsoleMethodName = 'log' | 'warn' | 'error';

const ansiPattern = /\u001b\[[0-9;]*m/g;
const timestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /;

const originalConsole: Record<ConsoleMethodName, Console['log']> = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

const outputs: Record<ConsoleMethodName, string[]> = {
  log: [],
  warn: [],
  error: []
};

const stripAnsi = (value: string): string => value.replace(ansiPattern, '');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const capture = (method: ConsoleMethodName, sink: string[]): void => {
  const writer = (...data: unknown[]): void => {
    sink.push(data.map(item => String(item)).join(' '));
  };
  console[method] = writer as Console['log'];
};

const expectLine = (raw: string, label: string, message: string): void => {
  const value = stripAnsi(raw);
  const pattern = new RegExp(`^${timestampPattern.source}${label}\\s+${escapeRegExp(message)}$`);
  assert.match(value, pattern);
};

beforeEach(() => {
  outputs.log = [];
  outputs.warn = [];
  outputs.error = [];
  capture('log', outputs.log);
  capture('warn', outputs.warn);
  capture('error', outputs.error);
});

afterEach(() => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

test('Logger 输出包含时间戳前缀', () => {
  const logger = new Logger({ verbose: true });

  logger.info('hello');
  logger.success('ok');
  logger.warn('warning');
  logger.error('boom');
  logger.debug('detail');

  assert.equal(outputs.log.length, 3);
  assert.equal(outputs.warn.length, 1);
  assert.equal(outputs.error.length, 1);

  expectLine(outputs.log[0], 'info', 'hello');
  expectLine(outputs.log[1], 'ok', 'ok');
  expectLine(outputs.log[2], 'dbg', 'detail');
  expectLine(outputs.warn[0], 'warn', 'warning');
  expectLine(outputs.error[0], 'err', 'boom');
});
