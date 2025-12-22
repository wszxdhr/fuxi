type Colorizer = (value: string) => string;

const wrap = (code: string): Colorizer => (value: string) => `\u001b[${code}m${value}\u001b[0m`;

const colors = {
  blue: wrap('34'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  magenta: wrap('35'),
  gray: wrap('90')
} as const;

export interface LoggerOptions {
  readonly verbose?: boolean;
}

export class Logger {
  private readonly verbose: boolean;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose ?? false;
  }

  info(message: string): void {
    console.log(this.formatLine(colors.blue('info'), '  ', message));
  }

  success(message: string): void {
    console.log(this.formatLine(colors.green('ok'), '    ', message));
  }

  warn(message: string): void {
    console.warn(this.formatLine(colors.yellow('warn'), '  ', message));
  }

  error(message: string): void {
    console.error(this.formatLine(colors.red('err'), '   ', message));
  }

  debug(message: string): void {
    if (!this.verbose) return;
    console.log(this.formatLine(colors.magenta('dbg'), '   ', message));
  }

  private formatLine(label: string, padding: string, message: string): string {
    const timestamp = this.formatTimestamp(new Date());
    return `${colors.gray(timestamp)} ${label}${padding}${message}`;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = this.pad2(date.getMonth() + 1);
    const day = this.pad2(date.getDate());
    const hours = this.pad2(date.getHours());
    const minutes = this.pad2(date.getMinutes());
    const seconds = this.pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private pad2(value: number): string {
    return String(value).padStart(2, '0');
  }
}

export const defaultLogger = new Logger();
