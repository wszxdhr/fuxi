import fs from 'fs-extra';
import { pad2 } from './utils';

type Colorizer = (value: string) => string;
type ConsoleMethodName = 'log' | 'warn' | 'error';

const wrap = (code: string): Colorizer => (value: string) => `\u001b[${code}m${value}\u001b[0m`;

const colors = {
  blue: wrap('34'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  magenta: wrap('35'),
  gray: wrap('90')
} as const;

/**
 * 日志器配置项。
 */
export interface LoggerOptions {
  readonly verbose?: boolean;
  readonly logFile?: string;
}

/**
 * 带颜色的日志输出器，可选写入日志文件。
 */
export class Logger {
  private readonly verbose: boolean;
  private readonly logFile?: string;
  private logFileEnabled: boolean;
  private logFileErrored: boolean;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose ?? false;
    const trimmedPath = options.logFile?.trim();
    this.logFile = trimmedPath && trimmedPath.length > 0 ? trimmedPath : undefined;
    this.logFileEnabled = Boolean(this.logFile);
    this.logFileErrored = false;

    if (this.logFile) {
      try {
        fs.ensureFileSync(this.logFile);
      } catch (error) {
        this.disableFileWithError(error);
      }
    }
  }

  info(message: string): void {
    this.emit('log', colors.blue, 'info', '  ', message);
  }

  success(message: string): void {
    this.emit('log', colors.green, 'ok', '    ', message);
  }

  warn(message: string): void {
    this.emit('warn', colors.yellow, 'warn', '  ', message);
  }

  error(message: string): void {
    this.emit('error', colors.red, 'err', '   ', message);
  }

  debug(message: string): void {
    if (!this.verbose) return;
    this.emit('log', colors.magenta, 'dbg', '   ', message);
  }

  private emit(method: ConsoleMethodName, colorizer: Colorizer, label: string, padding: string, message: string): void {
    const now = new Date();
    const consoleLine = this.formatConsoleLine(now, colorizer(label), padding, message);
    const fileLine = this.formatFileLine(now, label, padding, message);
    console[method](consoleLine);
    this.writeFileLine(fileLine);
  }

  private formatConsoleLine(date: Date, label: string, padding: string, message: string): string {
    const timestamp = this.formatTimestamp(date);
    return `${colors.gray(timestamp)} ${label}${padding}${message}`;
  }

  private formatFileLine(date: Date, label: string, padding: string, message: string): string {
    const timestamp = this.formatTimestamp(date);
    return `${timestamp} ${label}${padding}${message}`;
  }

  private writeFileLine(line: string): void {
    if (!this.logFileEnabled || !this.logFile) return;
    try {
      fs.appendFileSync(this.logFile, `${line}\n`, 'utf8');
    } catch (error) {
      this.disableFileWithError(error);
    }
  }

  private disableFileWithError(error: unknown): void {
    this.logFileEnabled = false;
    if (this.logFileErrored) return;
    this.logFileErrored = true;
    const message = error instanceof Error ? error.message : String(error);
    const target = this.logFile ? ` (${this.logFile})` : '';
    console.warn(`日志文件写入失败${target}，已停止写入：${message}`);
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    const seconds = pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}

/**
 * 默认日志器实例。
 */
export const defaultLogger = new Logger();
