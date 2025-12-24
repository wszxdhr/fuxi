import fs from 'fs-extra';
import path from 'node:path';

export interface QualityCommand {
  readonly name: string;
  readonly command: string;
}

function hasScript(scripts: Record<string, string>, name: string): boolean {
  return typeof scripts[name] === 'string' && scripts[name].trim().length > 0;
}

/**
 * 读取 package.json，解析可用的代码质量检查命令。
 */
export async function detectQualityCommands(workDir: string): Promise<QualityCommand[]> {
  const packagePath = path.join(workDir, 'package.json');
  const exists = await fs.pathExists(packagePath);
  if (!exists) return [];

  const pkg = await fs.readJson(packagePath);
  const scripts = typeof pkg === 'object' && pkg && typeof (pkg as { scripts?: unknown }).scripts === 'object'
    ? ((pkg as { scripts: Record<string, string> }).scripts ?? {})
    : {};

  const commands: QualityCommand[] = [];
  const seen = new Set<string>();

  const append = (name: string, command: string): void => {
    if (seen.has(name)) return;
    if (!hasScript(scripts, name)) return;
    commands.push({ name, command });
    seen.add(name);
  };

  append('lint', 'yarn lint');
  append('lint:ci', 'yarn lint:ci');
  append('lint:check', 'yarn lint:check');
  append('typecheck', 'yarn typecheck');
  append('format:check', 'yarn format:check');
  append('format:ci', 'yarn format:ci');

  if (!hasScript(scripts, 'format:check') && !hasScript(scripts, 'format:ci')) {
    append('format', 'yarn format');
  }

  return commands;
}
