import { Command } from 'commander';
import { buildLoopConfig, CliOptions, defaultNotesPath, defaultPlanPath, defaultWorkflowDoc } from './config';
import { runLoop } from './loop';
import { defaultLogger } from './logger';

function parseInteger(value: string, defaultValue: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name('fuxi')
    .description('基于 AI CLI 的持续迭代开发工具')
    .version('1.0.0');

  program
    .command('run')
    .requiredOption('-t, --task <task>', '需要完成的任务描述（会进入 AI 提示）')
    .option('-i, --iterations <number>', '最大迭代次数', value => parseInteger(value, 5), 5)
    .option('--ai-cli <command>', 'AI CLI 命令', 'claude')
    .option('--ai-args <args...>', 'AI CLI 参数', [])
    .option('--ai-prompt-arg <flag>', '用于传入 prompt 的参数（为空则使用 stdin）')
    .option('--notes-file <path>', '持久化记忆文件', defaultNotesPath())
    .option('--plan-file <path>', '计划文件', defaultPlanPath())
    .option('--workflow-doc <path>', 'AI 工作流程说明文件', defaultWorkflowDoc())
    .option('--worktree', '在独立 worktree 上执行', false)
    .option('--branch <name>', 'worktree 分支名（默认自动生成或当前分支）')
    .option('--worktree-path <path>', 'worktree 路径，默认 ../worktrees/<branch>')
    .option('--base-branch <name>', '创建分支的基线分支', 'main')
    .option('--run-tests', '运行单元测试命令', false)
    .option('--run-e2e', '运行 e2e 测试命令', false)
    .option('--unit-command <cmd>', '单元测试命令', 'yarn test')
    .option('--e2e-command <cmd>', 'e2e 测试命令', 'yarn e2e')
    .option('--auto-commit', '自动 git commit', false)
    .option('--auto-push', '自动 git push', false)
    .option('--pr', '使用 gh 创建 PR', false)
    .option('--pr-title <title>', 'PR 标题')
    .option('--pr-body <path>', 'PR 描述文件路径（可留空自动生成）')
    .option('--draft', '以草稿形式创建 PR', false)
    .option('--reviewer <user...>', 'PR reviewers', collect, [])
    .option('--stop-signal <token>', 'AI 输出中的停止标记', '<<DONE>>')
    .option('-v, --verbose', '输出调试日志', false)
    .action(async (options) => {
      const cliOptions: CliOptions = {
        task: options.task as string,
        iterations: options.iterations as number,
        aiCli: options.aiCli as string,
        aiArgs: (options.aiArgs as string[]) ?? [],
        aiPromptArg: options.aiPromptArg as string | undefined,
        notesFile: options.notesFile as string,
        planFile: options.planFile as string,
        workflowDoc: options.workflowDoc as string,
        useWorktree: Boolean(options.worktree),
        branch: options.branch as string | undefined,
        worktreePath: options.worktreePath as string | undefined,
        baseBranch: options.baseBranch as string,
        runTests: Boolean(options.runTests),
        runE2e: Boolean(options.runE2e),
        unitCommand: options.unitCommand as string | undefined,
        e2eCommand: options.e2eCommand as string | undefined,
        autoCommit: Boolean(options.autoCommit),
        autoPush: Boolean(options.autoPush),
        pr: Boolean(options.pr),
        prTitle: options.prTitle as string | undefined,
        prBody: options.prBody as string | undefined,
        draft: Boolean(options.draft),
        reviewers: (options.reviewer as string[]) ?? [],
        stopSignal: options.stopSignal as string,
        verbose: Boolean(options.verbose)
      };

      const config = buildLoopConfig(cliOptions, process.cwd());
      await runLoop(config);
    });

  await program.parseAsync(argv);
}

if (require.main === module) {
  runCli(process.argv).catch(error => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    defaultLogger.error(message);
    process.exitCode = 1;
  });
}
