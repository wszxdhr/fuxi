import path from 'node:path';
import fs from 'fs-extra';
import { CommandOptions, CommandResult } from './types';

type ExecaError = import('execa').ExecaError;

async function getExeca() {
  return import('execa');
}

export async function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  try {
    const { execa } = await getExeca();
    const result = await execa(command, args, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      all: false
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      exitCode: result.exitCode ?? 0
    };
  } catch (error) {
    const execaError = error as ExecaError;
    return {
      stdout: String(execaError.stdout ?? ''),
      stderr: String(execaError.stderr ?? String(error)),
      exitCode: execaError.exitCode ?? 1
    };
  }
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function resolvePath(cwd: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(cwd, target);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdirp(dirPath);
}

export async function ensureFile(filePath: string, initialContent = ''): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    await fs.writeFile(filePath, initialContent, 'utf8');
  }
}

export async function appendSection(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `\n${content}\n`, 'utf8');
}

export async function readFileSafe(filePath: string): Promise<string> {
  const exists = await fs.pathExists(filePath);
  if (!exists) return '';
  return fs.readFile(filePath, 'utf8');
}

export function formatHeading(title: string): string {
  return `## ${title}\n`;
}
