import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAiEnv, parseEnvPairs } from '../src/env';

test('parseEnvPairs parses key=value pairs', () => {
  const env = parseEnvPairs(['FOO=bar', 'HTTP_PROXY=http://a=b']);

  assert.equal(env.FOO, 'bar');
  assert.equal(env.HTTP_PROXY, 'http://a=b');
});

test('parseEnvPairs throws on invalid input', () => {
  assert.throws(() => parseEnvPairs(['BADPAIR']));
});

test('buildAiEnv merges process env with overrides', () => {
  const key = 'FUXI_TEST_ENV';
  const previous = process.env[key];
  process.env[key] = 'from_process';

  const env = buildAiEnv({ envOverrides: { [key]: 'override' } });
  assert.equal(env[key], 'override');

  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
});
