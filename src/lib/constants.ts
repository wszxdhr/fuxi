/**
 * 全局常量定义模块
 * 集中管理项目中的魔法字符串和数字
 */

/**
 * 日志输出相关常量
 */
export const LOG_LIMITS = {
  /** 最大日志输出长度 */
  MAX_OUTPUT_LENGTH: 4000,
  /** git status 摘要最大长度 */
  GIT_STATUS_SNIPPET_LIMIT: 1000,
  /** git diff 统计最大长度 */
  DIFF_STAT_SNIPPET_LIMIT: 1000,
  /** 计划内容摘要最大长度 */
  PLAN_SNIPPET_LIMIT: 2000,
  /** notes 内容摘要最大长度 */
  NOTES_SNIPPET_LIMIT: 4000,
  /** AI 输出摘要最大长度 */
  AI_OUTPUT_SNIPPET_LIMIT: 3000,
  /** 文本截断默认长度 */
  TRUNCATE_DEFAULT_LIMIT: 100
} as const;

/**
 * Webhook 相关常量
 */
export const WEBHOOK = {
  /** 默认请求超时时间（毫秒） */
  DEFAULT_TIMEOUT_MS: 8000
} as const;

/**
 * 分支类型常量
 */
export const BRANCH_TYPES = ['feat', 'fix', 'docs', 'refactor', 'chore', 'test'] as const;

/** 分支类型字面量类型 */
export type BranchType = typeof BRANCH_TYPES[number];

/**
 * 分支类型别名映射（支持常见变体）
 */
export const BRANCH_TYPE_ALIASES: Readonly<Record<string, BranchType>> = {
  feature: 'feat',
  features: 'feat',
  bugfix: 'fix',
  hotfix: 'fix',
  doc: 'docs',
  documentation: 'docs',
  refactoring: 'refactor',
  chores: 'chore',
  tests: 'test'
};

/**
 * PR 文案必需章节
 */
export const REQUIRED_PR_SECTIONS = ['# 变更摘要', '# 测试结果', '# 风险与回滚'] as const;

/**
 * Git 分支名相关常量
 */
export const BRANCH_NAME = {
  /** 分支名最大长度 */
  MAX_SLUG_LENGTH: 40,
  /** 分支名最小长度 */
  MIN_SLUG_LENGTH: 3
} as const;

/**
 * 文件路径相关常量
 */
export const FILE_PATHS = {
  /** memory 目录 */
  MEMORY_DIR: 'memory',
  /** docs 目录 */
  DOCS_DIR: 'docs',
  /** 默认 notes 文件名 */
  NOTES_FILE: 'notes.md',
  /** 默认 plan 文件名 */
  PLAN_FILE: 'plan.md',
  /** 默认工作流文档文件名 */
  WORKFLOW_DOC: 'ai-workflow.md',
  /** PR body 默认文件名 */
  PR_BODY_FILE: 'pr-body.md',
  /** worktrees 父目录名 */
  WORKTREES_DIR: 'worktrees'
} as const;

/**
 * 质量检查命令名称优先级列表
 */
export const QUALITY_COMMAND_NAMES = [
  'lint',
  'lint:ci',
  'lint:check',
  'typecheck',
  'format:check',
  'format:ci',
  'format'
] as const;

/**
 * 质量检查跳过关键词
 */
export const QUALITY_SKIP_KEYWORDS = [
  '不要检查代码质量',
  '不检查代码质量',
  '跳过代码质量'
] as const;

/**
 * 测试相关关键词（用于检测 plan 中是否包含测试内容）
 */
export const TEST_KEYWORDS = [
  '测试',
  'test',
  'e2e',
  '单测'
] as const;

/**
 * 任务类型推断关键词
 */
export const TASK_TYPE_KEYWORDS = {
  fix: ['fix', 'bug', '修复', '错误', '异常', '问题'],
  docs: ['docs', 'readme', 'changelog', '文档'],
  test: ['test', 'e2e', '单测', '测试'],
  refactor: ['refactor', '重构'],
  chore: ['chore', '构建', '依赖', '配置']
} as const;

/**
 * 默认兜底分支名前缀
 */
export const DEFAULT_BRANCH_PREFIX = 'wheel-ai';

/**
 * 时间戳格式相关常量
 */
export const TIMESTAMP_FORMAT = {
  /** ISO 8601 格式 */
  ISO: 'YYYY-MM-DDTHH:mm:ss.sssZ',
  /** 本地时间戳格式 */
  LOCAL: 'YYYYMMDD-HHmmss'
} as const;
