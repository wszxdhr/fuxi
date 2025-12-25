# Changelog

本项目遵循语义化版本，变更日志以时间倒序记录。

## [0.3.4] - 2025-12-25
### Fixed
- `agent set` 允许透传包含 `--` 的子命令参数，避免 `unknown option` 报错。

## [0.3.3] - 2025-12-25
### Fixed
- `--version` 改为从 `package.json` 读取版本号，避免硬编码不一致。

## [0.3.2] - 2025-12-24
### Fixed
- webhook 的 `project` 字段固定为首次识别的仓库目录名，切换 worktree 后保持不变。

## [0.3.1] - 2025-12-24
### Added
- webhook 在“计划生成”阶段新增 `plan` 字段，携带计划原文便于下游对接。

### Fixed
- webhook 发送的 `plan` 内容统一为 `\n` 换行，确保换行不丢失。

## [0.3.0] - 2025-12-24
### Added
- 新增 `alias set/list/delete` 命令，用于管理全局 alias 配置。
- `run` 支持多次 `--use-alias` 叠加，并按命令行顺序覆盖同名选项。
- `run` 新增 `--use-agent`，支持叠加 agent 配置并参与覆盖合并。

### Changed
- alias 管理方式调整为 `alias set/list/delete`，便于显式维护与查看。
- alias 列表仅展示 `[alias]` 段，避免与 shortcut 混淆。
- run 参数合并规则统一为“同名选项后出现覆盖前出现”。

## [0.2.1] - 2025-12-24
### Added
- webhook payload 新增 `project` 字段，值为当前工作目录名称（仅文件夹名）。
- webhook payload 新增 `commit` 与 `pr` 字段，用于提交与 PR 链接（无链接时为空字符串）。
- 新增 `agent add/delete/set/list` 命令，支持管理 AI CLI 命令配置。
- 支持在全局配置中存储与解析 `[agent]` 表（兼容 `[agents]` 读取），便于复用 AI CLI 命令。

### Changed
- 仅在 `task_start` 事件发送 `task` 字段，其余阶段不再携带。
- webhook 时间戳改为本地时区 `YYYYMMDD-HHmmss` 格式。
- logs 列表支持 PageUp/PageDown 翻页，并补充按键提示。

## [0.2.0] - 2025-12-24
### Added
- 新增 `alias run` 子命令，支持执行 alias 时追加参数并覆盖同名选项。
- 支持多任务执行与 multi-task 模式，提供 relay（接力）、serial（串行）、serial-continue（串行继续）、parallel（并行）四种执行方式。
- 新增 `alias` 命令，提供交互式 alias 配置浏览界面，支持上下键选择与 q 退出。
- Monitor 支持通过 `t` 键终止运行中的任务，增加确认对话框防止误操作。
- 前台运行时支持按 Esc 切入后台运行，日志自动输出到文件。
- 日志查看器（logs）支持单行滚动与翻页浏览，Esc 或 b 返回列表。

### Changed
- 优化 AI 多阶段流程与交付闭环，改进分阶段 session 执行逻辑。
- 项目从 hamster-wheel-cli 重命名为 wheel-ai，更新相关引用与命令入口。
- GitHub Actions 工作流 Node.js 版本从 18 升级到 20。

### Fixed
- 修复分支名格式生成逻辑，确保符合 git 分支命名规范。

## [0.1.1] - 2025-12-24
### Added
- 引入分阶段 AI session 流程：分支名生成、计划执行、质量检查、测试、文档更新。
- 支持根据任务生成分支名（AI 优先，失败兜底）。
- 自动检测并执行代码质量检查，支持失败修复循环。
- 新增 `--skip-quality` 与 `--auto-merge` CLI 选项。

### Changed
- 多任务未显式指定分支时不再自动生成分支名，改由 AI 在运行时生成。
- 迭代记录补充阶段与质量检查结果，便于回溯。

## [0.1.0] - 2025-12-23
### Added
- 基于 commander 的 AI 驱动 CLI，支持通过外部 AI CLI 运行迭代流程。
- 集成 git worktree 与 `gh`，自动化创建分支、推送与 PR。
- 支持单元测试与 e2e 测试的统一触发与结果收集。
- 提供计划与记录持久化（`memory/plan.md`、`memory/notes.md`），便于多轮迭代复用。
- 支持 webhook 通知、日志查看与本地配置快捷指令，提升可观测性与易用性。
