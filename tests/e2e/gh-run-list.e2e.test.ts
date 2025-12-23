import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listFailedRuns } from '../../src/gh';
import { Logger } from '../../src/logger';

test('listFailedRuns 可识别失败的 Actions 运行', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-wheel-cli-gh-'));
  const ghPath = path.join(tempDir, 'gh');
  const output = [
    {
      databaseId: 201,
      name: 'CI',
      status: 'completed',
      conclusion: 'failure',
      url: 'https://example.com/ci'
    },
    {
      databaseId: 202,
      name: 'Lint',
      status: 'completed',
      conclusion: 'success',
      url: 'https://example.com/lint'
    }
  ];
  const script = `#!/usr/bin/env node\nprocess.stdout.write('${JSON.stringify(output)}');\n`;

  await fs.writeFile(ghPath, script, 'utf8');
  await fs.chmod(ghPath, 0o755);

  const previousPath = process.env.PATH ?? '';
  process.env.PATH = `${tempDir}${path.delimiter}${previousPath}`;

  try {
    const logger = new Logger({ verbose: false });
    const runs = await listFailedRuns('demo-branch', process.cwd(), logger);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].name, 'CI');
    assert.equal(runs[0].conclusion, 'failure');
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
