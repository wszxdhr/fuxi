import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fs from 'fs-extra';
import { CurrentRegistry } from '../src/logs';
import { buildRunningLogKeys, loadLogEntries } from '../src/logs-viewer';

test('buildRunningLogKeys 会合并 registry key 与 logFile 名称', () => {
  const registry: CurrentRegistry = {
    'alpha.log': {
      command: 'cmd',
      round: 1,
      tokenUsed: 2,
      path: '/tmp',
      logFile: '/var/log/alpha.log'
    },
    'beta.log': {
      command: 'cmd',
      round: 1,
      tokenUsed: 2,
      path: '/tmp'
    }
  };

  const keys = buildRunningLogKeys(registry);
  assert.ok(keys.has('alpha.log'));
  assert.ok(keys.has('beta.log'));
});

test('loadLogEntries 会排除运行中的日志与非 .log 文件', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fuxi-logs-'));
  try {
    const logA = path.join(tempDir, 'alpha.log');
    const logB = path.join(tempDir, 'beta.log');
    const txt = path.join(tempDir, 'note.txt');
    await fs.writeFile(logA, 'alpha', 'utf8');
    await fs.writeFile(logB, 'beta', 'utf8');
    await fs.writeFile(txt, 'note', 'utf8');

    const registry: CurrentRegistry = {
      'beta.log': {
        command: 'cmd',
        round: 1,
        tokenUsed: 2,
        path: '/tmp',
        logFile: logB
      }
    };

    const entries = await loadLogEntries(tempDir, registry);
    const names = entries.map(entry => entry.fileName);
    assert.deepEqual(names, ['alpha.log']);
  } finally {
    await fs.remove(tempDir);
  }
});
