import path from 'node:path';
import { AiCliConfig, LoopConfig, PrConfig, TestConfig, WorktreeConfig, WorkflowFiles } from './types';
import { resolvePath } from './utils';

/**
 * CLI 参数解析后的配置。
 */
export interface CliOptions {
  readonly task: string;
  readonly iterations: number;
  readonly aiCli: string;
  readonly aiArgs: string[];
  readonly aiPromptArg?: string;
  readonly notesFile: string;
  readonly planFile: string;
  readonly workflowDoc: string;
  readonly useWorktree: boolean;
  readonly branch?: string;
  readonly worktreePath?: string;
  readonly baseBranch: string;
  readonly runTests: boolean;
  readonly runE2e: boolean;
  readonly unitCommand?: string;
  readonly e2eCommand?: string;
  readonly autoCommit: boolean;
  readonly autoPush: boolean;
  readonly pr: boolean;
  readonly prTitle?: string;
  readonly prBody?: string;
  readonly draft: boolean;
  readonly reviewers?: string[];
  readonly stopSignal: string;
  readonly logFile?: string;
  readonly verbose: boolean;
  readonly skipInstall: boolean;
}

function buildAiConfig(options: CliOptions): AiCliConfig {
  return {
    command: options.aiCli,
    args: options.aiArgs,
    promptArg: options.aiPromptArg
  };
}

function buildWorktreeConfig(options: CliOptions): WorktreeConfig {
  return {
    useWorktree: options.useWorktree,
    branchName: options.branch,
    worktreePath: options.worktreePath,
    baseBranch: options.baseBranch
  };
}

function buildTestConfig(options: CliOptions): TestConfig {
  return {
    unitCommand: options.unitCommand,
    e2eCommand: options.e2eCommand
  };
}

function buildPrConfig(options: CliOptions): PrConfig {
  return {
    enable: options.pr,
    title: options.prTitle,
    bodyPath: options.prBody,
    draft: options.draft,
    reviewers: options.reviewers
  };
}

function buildWorkflowFiles(options: CliOptions, cwd: string): WorkflowFiles {
  return {
    workflowDoc: resolvePath(cwd, options.workflowDoc),
    notesFile: resolvePath(cwd, options.notesFile),
    planFile: resolvePath(cwd, options.planFile)
  };
}

/**
 * 构建循环执行所需的配置对象。
 */
export function buildLoopConfig(options: CliOptions, cwd: string): LoopConfig {
  return {
    task: options.task,
    iterations: options.iterations,
    stopSignal: options.stopSignal,
    ai: buildAiConfig(options),
    workflowFiles: buildWorkflowFiles(options, cwd),
    git: buildWorktreeConfig(options),
    tests: buildTestConfig(options),
    pr: buildPrConfig(options),
    cwd,
    logFile: options.logFile ? resolvePath(cwd, options.logFile) : undefined,
    verbose: options.verbose,
    runTests: options.runTests,
    runE2e: options.runE2e,
    autoCommit: options.autoCommit,
    autoPush: options.autoPush,
    skipInstall: options.skipInstall
  };
}

/**
 * 默认 notes 文件路径。
 */
export function defaultNotesPath(): string {
  return path.join('memory', 'notes.md');
}

/**
 * 默认 plan 文件路径。
 */
export function defaultPlanPath(): string {
  return path.join('memory', 'plan.md');
}

/**
 * 默认工作流说明文件路径。
 */
export function defaultWorkflowDoc(): string {
  return path.join('docs', 'ai-workflow.md');
}
