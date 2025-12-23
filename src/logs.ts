import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { pad2 } from './utils';

export interface RunMetadata {
  readonly command: string;
  readonly round: number;
  readonly tokenUsed: number;
  readonly path: string;
  readonly pid?: number;
}

export interface CurrentRegistryEntry extends RunMetadata {
  readonly logFile?: string;
}

export type CurrentRegistry = Record<string, CurrentRegistryEntry>;

const LOGS_DIR = path.join(os.homedir(), '.wheel-ai', 'logs');

export function getLogsDir(): string {
  return LOGS_DIR;
}

export function getCurrentRegistryPath(): string {
  return path.join(LOGS_DIR, 'current.json');
}

export async function ensureLogsDir(): Promise<void> {
  await fs.mkdirp(LOGS_DIR);
}

/**
 * 生成时间字符串（YYYYMMDDHHmmss）。
 */
export function formatTimeString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * 清理分支名中的非法字符。
 */
export function sanitizeBranchName(branchName: string): string {
  const normalized = branchName.trim();
  if (!normalized) return '';
  const replaced = normalized.replace(/[\\/:*?"<>|\s]+/g, '-');
  return replaced.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function buildAutoLogFilePath(branchName: string, date: Date = new Date()): string {
  const safeBranch = sanitizeBranchName(branchName) || 'unknown';
  return path.join(LOGS_DIR, `wheel-ai-auto-log-${formatTimeString(date)}-${safeBranch}.log`);
}

export function getLogMetaPath(logFile: string): string {
  const baseName = path.basename(logFile, path.extname(logFile));
  return path.join(LOGS_DIR, `${baseName}.json`);
}

function buildLogKey(logFile: string): string {
  return path.basename(logFile);
}

/**
 * 格式化命令行字符串（用于写入元信息）。
 */
export function formatCommandLine(argv: string[]): string {
  const quote = (value: string): string => {
    if (/[\s"'\\]/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  };
  return argv.map(quote).join(' ').trim();
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureLogsDir();
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * 写入单次运行的元信息。
 */
export async function writeRunMetadata(logFile: string, metadata: RunMetadata): Promise<void> {
  const metaPath = getLogMetaPath(logFile);
  await writeJsonFile(metaPath, metadata);
}

/**
 * 读取 current.json 注册表。
 */
export async function readCurrentRegistry(): Promise<CurrentRegistry> {
  const filePath = getCurrentRegistryPath();
  const exists = await fs.pathExists(filePath);
  if (!exists) return {};
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as CurrentRegistry;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * 更新 current.json 中的运行记录。
 */
export async function upsertCurrentRegistry(logFile: string, metadata: RunMetadata): Promise<void> {
  const registry = await readCurrentRegistry();
  const key = buildLogKey(logFile);
  registry[key] = { ...metadata, logFile };
  await writeJsonFile(getCurrentRegistryPath(), registry);
}

/**
 * 从 current.json 中移除运行记录。
 */
export async function removeCurrentRegistry(logFile: string): Promise<void> {
  const registry = await readCurrentRegistry();
  const key = buildLogKey(logFile);
  if (!(key in registry)) return;
  delete registry[key];
  await writeJsonFile(getCurrentRegistryPath(), registry);
}
