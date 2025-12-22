import type { Logger } from './logger';

export interface AiCliConfig {
  readonly command: string;
  readonly args: string[];
  readonly promptArg?: string;
  readonly env?: Record<string, string>;
}

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens: number;
}

export interface AiResult {
  readonly output: string;
  readonly usage: TokenUsage | null;
}

export interface WorktreeConfig {
  readonly useWorktree: boolean;
  readonly branchName?: string;
  readonly worktreePath?: string;
  readonly baseBranch: string;
}

export interface TestConfig {
  readonly unitCommand?: string;
  readonly e2eCommand?: string;
}

export interface TestRunResult {
  readonly kind: 'unit' | 'e2e';
  readonly command: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PrConfig {
  readonly enable: boolean;
  readonly title?: string;
  readonly bodyPath?: string;
  readonly draft?: boolean;
  readonly reviewers?: string[];
}

export interface WorkflowFiles {
  readonly workflowDoc: string;
  readonly notesFile: string;
  readonly planFile: string;
}

export interface LoopConfig {
  readonly task: string;
  readonly iterations: number;
  readonly stopSignal: string;
  readonly ai: AiCliConfig;
  readonly workflowFiles: WorkflowFiles;
  readonly git: WorktreeConfig;
  readonly tests: TestConfig;
  readonly pr: PrConfig;
  readonly cwd: string;
  readonly verbose: boolean;
  readonly runTests: boolean;
  readonly runE2e: boolean;
  readonly autoCommit: boolean;
  readonly autoPush: boolean;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly input?: string;
  readonly logger?: Logger;
  readonly verboseLabel?: string;
  readonly verboseCommand?: string;
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface IterationRecord {
  readonly iteration: number;
  readonly prompt: string;
  readonly aiOutput: string;
  readonly timestamp: string;
  readonly testResults?: TestRunResult[];
}
