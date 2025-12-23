# Changelog

本项目遵循语义化版本，变更日志以时间倒序记录。

## [0.1.0] - 2025-12-23
### Added
- 基于 commander 的 AI 驱动 CLI，支持通过外部 AI CLI 运行迭代流程。
- 集成 git worktree 与 `gh`，自动化创建分支、推送与 PR。
- 支持单元测试与 e2e 测试的统一触发与结果收集。
- 提供计划与记录持久化（`memory/plan.md`、`memory/notes.md`），便于多轮迭代复用。
- 支持 webhook 通知、日志查看与本地配置快捷指令，提升可观测性与易用性。
