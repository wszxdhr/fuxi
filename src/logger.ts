import chalk from 'chalk';

export interface LoggerOptions {
  readonly verbose?: boolean;
}

export class Logger {
  private readonly verbose: boolean;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose ?? false;
  }

  info(message: string): void {
    console.log(`${chalk.blue('info')}  ${message}`);
  }

  success(message: string): void {
    console.log(`${chalk.green('ok')}    ${message}`);
  }

  warn(message: string): void {
    console.warn(`${chalk.yellow('warn')}  ${message}`);
  }

  error(message: string): void {
    console.error(`${chalk.red('err')}   ${message}`);
  }

  debug(message: string): void {
    if (!this.verbose) return;
    console.log(`${chalk.magenta('dbg')}   ${message}`);
  }
}

export const defaultLogger = new Logger();
