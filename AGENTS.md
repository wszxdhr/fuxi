# 项目介绍

hamster-wheel-cli 是一个面向本地工程的 AI 驱动迭代开发工具，基于 Node.js + commander，结合外部 AI CLI 串联需求澄清、计划生成、编码、自审、测试与 PR。

## 核心能力
- 通过统一提示驱动外部 AI CLI 执行迭代流程
- 自动化 git worktree 分支与 gh PR 协作
- 运行单元测试与 e2e 测试并记录结果
- 通过 plan/notes 持久化多轮迭代记忆

## 关键目录
- `docs/ai-workflow.md`：AI 工作流基线提示
- `memory/plan.md` / `memory/notes.md`：计划与迭代记录
- `src/`：CLI 实现
- `tests/`：测试用例

## 使用约束
- 包管理优先使用 `yarn`
- 文档与注释保持中文
- PR/Actions 相关操作仅使用 `gh` 命令
