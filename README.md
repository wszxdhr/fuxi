# Fuxi CLI

基于 Node.js + commander 的持续迭代开发工具，结合外部 AI CLI（运行时指定）驱动完整软件交付流程：需求澄清、计划生成、编码、自审、测试（单元+e2e）、推送与 PR。

## 安装与构建
```bash
yarn install
yarn build
```
生成的可执行文件位于 `dist/cli.js`，也可通过 `yarn dev` 直接运行 TypeScript 源码。

## 快速开始
```bash
node dist/cli.js run \
  --task "为现有项目补充自动化 CI" \
  --ai-cli "claude" \
  --ai-args "--model" "claude-3-opus" \
  --worktree \
  --base-branch main \
  --branch fuxi/ci-upgrade \
  --run-tests --run-e2e \
  --auto-commit --auto-push \
  --pr --pr-title "chore: 自动化 CI" \
  --stop-signal "<<DONE>>"
```
- `--ai-cli`/`--ai-args`：指向系统已有的 AI CLI，提示文本通过 stdin（或 `--ai-prompt-arg`）传入。
- `--worktree`：在独立分支 worktree 中作业；基线分支通过 `--base-branch` 指定。
- `--run-tests`/`--run-e2e`：运行测试命令（默认 `yarn test`、`yarn e2e`）。
- `--auto-commit`/`--auto-push`：迭代结束后自动提交与推送。
- `--pr`：使用 `gh pr create` 创建 PR，可配合 `--pr-title`/`--pr-body`/`--draft`/`--reviewer`。
- `-v, --verbose`：输出完整调试日志（包含执行命令、stdout/stderr），便于开发排查。

## 持久化记忆
- `docs/ai-workflow.md`：AI 执行前的工作流基线，需作为提示前置输入。
- `memory/plan.md`：分阶段计划（可被 AI 重写保持最新）。
- `memory/notes.md`：每轮迭代的输出、结论、风险与下一步。

## 开发约束
- 使用 yarn 管理依赖，TypeScript 避免 `any`。
- 与 git/PR 相关的命令仅使用 `gh`；工作分支使用 git worktree。
- 文档与注释保持中文。
