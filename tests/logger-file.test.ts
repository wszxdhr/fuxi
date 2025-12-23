import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { Logger } from '../src/logger';

const timestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /;
const tempRoot = path.join(process.cwd(), 'tests', '.tmp');

let tempFile: string | null = null;

const prepareTempFile = async (): Promise<string> => {
  await fs.mkdir(tempRoot, { recursive: true });
  const filePath = path.join(tempRoot, `logger-${randomUUID()}.log`);
  tempFile = filePath;
  return filePath;
};

const readLines = async (filePath: string): Promise<string[]> => {
  const content = await fs.readFile(filePath, 'utf8');
  return content.split(/\r?\n/).filter(line => line.length > 0);
};

afterEach(async () => {
  if (!tempFile) return;
  await fs.rm(tempFile, { force: true });
  tempFile = null;
});

test('Logger 写入日志文件（非 verbose 不写 debug）', async () => {
  const filePath = await prepareTempFile();
  const logger = new Logger({ verbose: false, logFile: filePath });

  logger.info('hello');
  logger.debug('detail');
  logger.warn('warning');

  const lines = await readLines(filePath);
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`${timestampPattern.source}info\\s+hello$`));
  assert.match(lines[1], new RegExp(`${timestampPattern.source}warn\\s+warning$`));
});

test('Logger verbose 时写入 debug', async () => {
  const filePath = await prepareTempFile();
  const logger = new Logger({ verbose: true, logFile: filePath });

  logger.success('ok');
  logger.debug('detail');

  const lines = await readLines(filePath);
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`${timestampPattern.source}ok\\s+ok$`));
  assert.match(lines[1], new RegExp(`${timestampPattern.source}dbg\\s+detail$`));
});
