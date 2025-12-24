# Changelog

本项目遵循语义化版本，变更日志以时间倒序记录。


## [0.2.1] - 2025-12-24
### Added
- 新增 `agent add/delete/set/list` 命令，支持管理 AI CLI 命令配置。
- 支持在全局配置中存储与解析 `[agent]` 表（兼容 `[agents]` 读取），便于复用 AI CLI 命令。

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
