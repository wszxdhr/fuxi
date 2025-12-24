# wheel-ai

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
  --task "补充测试覆盖" \
  --ai-cli "claude" \
  --ai-args "--model" "claude-3-opus" \
  --multi-task-mode relay \
  --worktree \
  --base-branch main \
  --branch wheel-ai/ci-upgrade \
  --run-tests --run-e2e \
  --auto-commit --auto-push \
  --pr --pr-title "chore: 自动化 CI" \
  --stop-signal "<<DONE>>"
```
- `-t, --task`：任务描述，可重复传入多个任务，默认按接力模式依次执行。
- `--ai-cli`/`--ai-args`：指向系统已有的 AI CLI，提示文本通过 stdin（或 `--ai-prompt-arg`）传入。
- `--use-alias`/`--use-agent`：叠加 alias/agent 配置参数，重复传入时按命令行顺序覆盖。
- `--worktree`：在独立分支 worktree 中作业；基线分支通过 `--base-branch` 指定。
- 使用 `--worktree` 创建的临时工作目录，在确认分支已提交、推送且存在 PR 后会自动清理（仅删除本次创建的 worktree）。
- `--run-tests`/`--run-e2e`：运行测试命令（默认 `yarn test`、`yarn e2e`）。
- `--auto-commit`/`--auto-push`：迭代结束后自动提交与推送。
- `--pr`：使用 `gh pr create` 创建 PR，可配合 `--pr-title`/`--pr-body`/`--draft`/`--reviewer`，未提供标题时会自动生成默认标题。
- `--auto-merge`：为 PR 启用自动合并（通过后自动 merge）。
- `--skip-install`：任务启动前跳过依赖检查与自动安装。
- `--skip-quality`：跳过代码质量检查环节。
- `--log-file`：将日志写入指定文件（相对路径基于当前工作目录）。
- `-v, --verbose`：输出完整调试日志（包含执行命令、stdout/stderr），便于开发排查。
- `--webhook`：配置通知回调地址（可重复设置多个 URL）。
- `--webhook-timeout`：webhook 请求超时（毫秒），默认 8000。
- `--multi-task-mode`：多任务执行模式，支持 `relay`（默认接力）、`serial`、`serial-continue`、`parallel`，也可用中文描述。

## 全局配置快捷指令
支持在 `~/.wheel-ai/config.toml` 配置一个快捷指令，用于减少重复的命令行参数书写。

```toml
[shortcut]
name = "daily"
command = "--task \"补充文档\" --ai-cli \"claude\" --ai-args \"--model\" \"claude-3-opus\" --worktree --run-tests"
```

使用时只需要输入快捷指令名称，后续参数会追加到快捷指令命令尾部：
```bash
wheel-ai daily --run-e2e
```
等价于：
```bash
wheel-ai run --task "补充文档" --ai-cli "claude" --ai-args "--model" "claude-3-opus" --worktree --run-tests --run-e2e
```

- `command` 中可选包含 `run`，会在展开时自动去除，避免重复。
- 仅支持一个 `[shortcut]`，且 `name` 不能包含空白字符。
- 配置文件不存在或内容不合法会被忽略，不影响正常使用。

## alias 管理与使用
可在 `~/.wheel-ai/config.toml` 中维护多个 alias，便于复用常用参数组合：

```toml
[alias]
daily = "--task \"补充文档\" --run-tests"
weekly = "--task \"补充测试\" --run-tests --run-e2e"
```

命令示例：
```bash
wheel-ai alias set daily --task "补充文档" --run-tests
wheel-ai alias list
wheel-ai alias delete daily
```

在 run 中叠加 alias：
```bash
wheel-ai run --use-alias daily --use-alias weekly -t "balabala"
```

- alias 名称不能为空且不能包含空白字符。
- `--use-alias` 可重复传入，按出现顺序叠加参数。
- 当出现同名选项时，后出现的 alias 覆盖前面的。

## agent 配置
可在 `~/.wheel-ai/config.toml` 中维护多个 AI CLI 命令，便于复用：

```toml
[agent]
claude = "claude --model sonnet"
openai = "openai --model gpt-4o"
```

命令示例：
```bash
wheel-ai agent add claude claude --model sonnet
wheel-ai agent set openai openai --model gpt-4o
wheel-ai agent delete claude
wheel-ai agent list
```

在 run 中使用 agent：
```bash
wheel-ai run --use-agent claude -t "补充文档"
```

- `--use-agent` 会叠加 agent 配置的参数，冲突时按命令行出现顺序覆盖。

- `add` 仅新增，已存在会报错。
- `set` 新增或覆盖。
- `delete` 删除指定 agent。
- `list` 输出全部 agent 配置。
- agent 名称不能为空且不能包含空白字符。

## 持久化记忆
- `docs/ai-workflow.md`：AI 执行前的工作流基线，需作为提示前置输入。
- `memory/plan.md`：分阶段计划（可被 AI 重写保持最新）。
- `memory/notes.md`：每轮迭代的输出、结论、风险与下一步。

## 运行中任务监控
- `wheel-ai monitor` 启动交互式监控，←/→ 切换任务，↑/↓ 上下 1 行，PageUp/PageDown 翻页。
- 在监控界面按 `t` 触发终止，会弹出确认框（y/n）。

## Webhook 通知
可通过 `--webhook` 配置通知回调地址，系统会在任务开始、第 N 轮开始、任务结束时发送 POST JSON。

Payload 示例：
```json
{
  "event": "task_start",
  "task": "修复依赖安装错误",
  "project": "webhook-start-task-project",
  "branch": "feat/webhooks",
  "iteration": 0,
  "stage": "任务开始",
  "timestamp": "20251224-210815",
  "commit": "",
  "pr": ""
}
```
字段说明：
- `event`：`task_start` / `iteration_start` / `task_end`
- `task`：任务描述（仅 `task_start` 会携带）
- `project`：当前工作目录名称（仅文件夹名，不含路径）
- `branch`：分支名（可能为空）
- `iteration`：当前轮次（任务开始为 0）
- `stage`：当前节点描述
- `timestamp`：本地时区 `YYYYMMDD-HHmmss` 时间戳
- `commit`：提交链接（仅在自动提交且推送成功时写入，否则为空字符串）
- `pr`：PR 链接（存在时写入，否则为空字符串）

## 开发约束
- 使用 yarn 管理依赖，TypeScript 避免 `any`。
- 与 git/PR 相关的命令仅使用 `gh`；工作分支使用 git worktree。
- 文档与注释保持中文。
