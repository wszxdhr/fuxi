export interface PlanItem {
  readonly index: number;
  readonly raw: string;
  readonly text: string;
  readonly completed: boolean;
}

const ITEM_PATTERN = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

function isCompleted(content: string): boolean {
  if (content.includes('✅')) return true;
  if (/\[[xX]\]/.test(content)) return true;
  return false;
}

function normalizeText(content: string): string {
  return content
    .replace(/\[[xX ]\]\s*/g, '')
    .replace(/✅/g, '')
    .trim();
}

/**
 * 解析 plan.md 中的计划项。
 */
export function parsePlanItems(plan: string): PlanItem[] {
  const lines = plan.split(/\r?\n/);
  const items: PlanItem[] = [];

  lines.forEach((line, index) => {
    const match = line.match(ITEM_PATTERN);
    if (!match) return;
    const content = match[3] ?? '';
    const text = normalizeText(content);
    if (!text) return;
    items.push({
      index,
      raw: line,
      text,
      completed: isCompleted(content)
    });
  });

  return items;
}

/**
 * 获取尚未完成的计划项。
 */
export function getPendingPlanItems(plan: string): PlanItem[] {
  return parsePlanItems(plan).filter(item => !item.completed);
}

/**
 * 获取最后一条未完成的计划项。
 */
export function getLastPendingPlanItem(plan: string): PlanItem | null {
  const pending = getPendingPlanItems(plan);
  if (pending.length === 0) return null;
  return pending[pending.length - 1] ?? null;
}
