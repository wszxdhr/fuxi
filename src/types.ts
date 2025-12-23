import type { Logger } from './logger';

/**
 * AI CLI 运行配置。
 */
export interface AiCliConfig {
  readonly command: string;
  readonly args: string[];
  readonly promptArg?: string;
}

/**
 * Token 使用统计。
 */
export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens: number;
}

/**
 * AI 调用结果。
 */
export interface AiResult {
  readonly output: string;
  readonly usage: TokenUsage | null;
}

/**
 * 提交信息结构。
 */
export interface CommitMessage {
  readonly title: string;
  readonly body?: string;
}

/**
 * 交付内容摘要（提交 + PR）。
 */
export interface DeliverySummary {
  readonly commitTitle: string;
  readonly commitBody?: string;
  readonly prTitle: string;
  readonly prBody: string;
}

/**
 * worktree 相关配置。
 */
export interface WorktreeConfig {
  readonly useWorktree: boolean;
  readonly branchName?: string;
  readonly worktreePath?: string;
  readonly baseBranch: string;
}

/**
 * worktree 创建结果。
 */
export interface WorktreeResult {
  readonly path: string;
  readonly created: boolean;
}

/**
 * 测试命令配置。
 */
export interface TestConfig {
  readonly unitCommand?: string;
  readonly e2eCommand?: string;
}

/**
 * 测试执行结果。
 */
export interface TestRunResult {
  readonly kind: 'unit' | 'e2e';
  readonly command: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * PR 配置。
 */
export interface PrConfig {
  readonly enable: boolean;
  readonly title?: string;
  readonly bodyPath?: string;
  readonly draft?: boolean;
  readonly reviewers?: string[];
}

/**
 * webhook 配置。
 */
export interface WebhookConfig {
  readonly urls: string[];
  readonly timeoutMs?: number;
}

/**
 * 工作流文件路径。
 */
export interface WorkflowFiles {
  readonly workflowDoc: string;
  readonly notesFile: string;
  readonly planFile: string;
}

/**
 * 主循环配置。
 */
export interface LoopConfig {
  readonly task: string;
  readonly iterations: number;
  readonly stopSignal: string;
  readonly ai: AiCliConfig;
  readonly workflowFiles: WorkflowFiles;
  readonly git: WorktreeConfig;
  readonly tests: TestConfig;
  readonly pr: PrConfig;
  readonly webhooks?: WebhookConfig;
  readonly cwd: string;
  readonly logFile?: string;
  readonly verbose: boolean;
  readonly runTests: boolean;
  readonly runE2e: boolean;
  readonly autoCommit: boolean;
  readonly autoPush: boolean;
  readonly skipInstall: boolean;
}

/**
 * 命令执行配置。
 */
export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly input?: string;
  readonly logger?: Logger;
  readonly verboseLabel?: string;
  readonly verboseCommand?: string;
  readonly stream?: StreamOptions;
}

/**
 * 命令执行结果。
 */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * 命令执行输出流配置。
 */
export interface StreamOptions {
  readonly enabled: boolean;
  readonly stdoutPrefix?: string;
  readonly stderrPrefix?: string;
}

/**
 * 迭代记录。
 */
export interface IterationRecord {
  readonly iteration: number;
  readonly prompt: string;
  readonly aiOutput: string;
  readonly timestamp: string;
  readonly testResults?: TestRunResult[];
}
