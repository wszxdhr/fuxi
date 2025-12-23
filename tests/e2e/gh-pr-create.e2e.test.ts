import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createPr } from '../../src/gh';
import { Logger } from '../../src/logger';
import type { PrConfig } from '../../src/types';

test('createPr 遇到已存在 PR 提示时视为成功', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fuxi-gh-'));
  const ghPath = path.join(tempDir, 'gh');
  const prInfo = {
    number: 12,
    title: 'feat: demo',
    url: 'https://example.com/pr/12',
    state: 'OPEN',
    headRefName: 'feat/demo'
  };
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const isCreate = args[0] === 'pr' && args[1] === 'create';
const isView = args[0] === 'pr' && args[1] === 'view';
if (isCreate) {
  process.stderr.write('pull request already exists');
  process.exit(1);
}
if (isView) {
  process.stdout.write('${JSON.stringify(prInfo)}');
  process.exit(0);
}
process.stderr.write('unknown command');
process.exit(1);
`;

  await fs.writeFile(ghPath, script, 'utf8');
  await fs.chmod(ghPath, 0o755);

  const previousPath = process.env.PATH ?? '';
  process.env.PATH = `${tempDir}${path.delimiter}${previousPath}`;

  try {
    const logger = new Logger({ verbose: false });
    const config: PrConfig = { enable: true };
    const result = await createPr('feat/demo', config, process.cwd(), logger);

    assert.ok(result);
    assert.equal(result?.url, prInfo.url);
    assert.equal(result?.number, prInfo.number);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
