import path from 'node:path';
import fs from 'fs-extra';
import { CommandOptions, CommandResult } from './types';

type ExecaModule = typeof import('execa');
type ExecaError = import('execa').ExecaError;

const importExeca = async (): Promise<ExecaModule> => {
  // 通过运行时动态 import 兼容 CommonJS 下加载 ESM 包
  const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<ExecaModule>;
  return importer('execa');
};

/**
 * 执行外部命令，支持日志与流式输出。
 */
export async function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  const label = options.verboseLabel ?? 'cmd';
  const displayCmd = options.verboseCommand ?? [command, ...args].join(' ');
  const cwd = options.cwd ?? process.cwd();
  options.logger?.debug(`[${label}] ${displayCmd} (cwd: ${cwd})`);

  const logger = options.logger;
  const streamEnabled = Boolean(options.stream?.enabled && logger);
  const stdoutPrefix = options.stream?.stdoutPrefix ?? `[${label}] `;
  const stderrPrefix = options.stream?.stderrPrefix ?? `[${label} stderr] `;

  const createLineStreamer = (prefix: string) => {
    let buffer = '';
    const emit = (line: string): void => {
      logger?.info(`${prefix}${line}`);
    };
    const push = (chunk: string | Buffer): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      buffer += text.replace(/\r/g, '\n');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      parts.forEach(emit);
    };
    const flush = (): void => {
      if (buffer.length === 0) return;
      emit(buffer);
      buffer = '';
    };
    return { push, flush };
  };

  const attachStream = (stream: NodeJS.ReadableStream | null | undefined, streamer: ReturnType<typeof createLineStreamer>): void => {
    if (!stream) return;
    if (typeof stream.setEncoding === 'function') {
      stream.setEncoding('utf8');
    }
    stream.on('data', streamer.push);
    stream.on('end', streamer.flush);
  };

  const stdoutStreamer = streamEnabled ? createLineStreamer(stdoutPrefix) : null;
  const stderrStreamer = streamEnabled ? createLineStreamer(stderrPrefix) : null;

  try {
    const { execa } = await importExeca();
    const subprocess = execa(command, args, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      all: false
    });
    if (stdoutStreamer) {
      attachStream(subprocess.stdout, stdoutStreamer);
    }
    if (stderrStreamer) {
      attachStream(subprocess.stderr, stderrStreamer);
    }
    const result = await subprocess;
    stdoutStreamer?.flush();
    stderrStreamer?.flush();
    const commandResult: CommandResult = {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      exitCode: result.exitCode ?? 0
    };
    if (logger) {
      const stdout = commandResult.stdout.trim();
      const stderr = commandResult.stderr.trim();
      if (stdout.length > 0) {
        logger.debug(`[${label}] stdout: ${stdout}`);
      }
      if (stderr.length > 0) {
        logger.debug(`[${label}] stderr: ${stderr}`);
      }
      logger.debug(`[${label}] exit ${commandResult.exitCode}`);
    }
    return commandResult;
  } catch (error) {
    const execaError = error as ExecaError;
    stdoutStreamer?.flush();
    stderrStreamer?.flush();
    const commandResult: CommandResult = {
      stdout: String(execaError.stdout ?? ''),
      stderr: String(execaError.stderr ?? String(error)),
      exitCode: execaError.exitCode ?? 1
    };
    if (logger) {
      const stdout = commandResult.stdout.trim();
      const stderr = commandResult.stderr.trim();
      if (stdout.length > 0) {
        logger.debug(`[${label}] stdout: ${stdout}`);
      }
      if (stderr.length > 0) {
        logger.debug(`[${label}] stderr: ${stderr}`);
      }
      logger.debug(`[${label}] exit ${commandResult.exitCode}`);
    }
    return commandResult;
  }
}

/**
 * 返回 ISO 格式时间戳。
 */
export function isoNow(): string {
  return new Date().toISOString();
}

/**
 * 基于 cwd 解析相对路径。
 */
export function resolvePath(cwd: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(cwd, target);
}

/**
 * 确保目录存在。
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdirp(dirPath);
}

/**
 * 确保文件存在（必要时创建）。
 */
export async function ensureFile(filePath: string, initialContent = ''): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    await fs.writeFile(filePath, initialContent, 'utf8');
  }
}

/**
 * 向文件末尾追加一段内容（包含换行）。
 */
export async function appendSection(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `\n${content}\n`, 'utf8');
}

/**
 * 安全读取文件内容，若不存在则返回空字符串。
 */
export async function readFileSafe(filePath: string): Promise<string> {
  const exists = await fs.pathExists(filePath);
  if (!exists) return '';
  return fs.readFile(filePath, 'utf8');
}

/**
 * 格式化 Markdown 标题。
 */
export function formatHeading(title: string): string {
  return `## ${title}\n`;
}

/**
 * 补齐两位数字字符串。
 */
export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
