const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function parseEnvPairs(pairs: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) {
      throw new Error(`AI 环境变量格式错误: ${pair}，请使用 KEY=VALUE`);
    }
    const key = pair.slice(0, index).trim();
    if (!isValidEnvKey(key)) {
      throw new Error(`AI 环境变量名称非法: ${key}`);
    }
    const value = pair.slice(index + 1);
    env[key] = value;
  }
  return env;
}

function normalizeProcessEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env;
}

export function mergeEnv(...sources: Array<Record<string, string>>): Record<string, string> {
  return sources.reduce<Record<string, string>>((acc, current) => ({
    ...acc,
    ...current
  }), {});
}

export function buildAiEnv(options: {
  readonly envOverrides?: Record<string, string>;
}): Record<string, string> {
  return mergeEnv(normalizeProcessEnv(process.env), options.envOverrides ?? {});
}
