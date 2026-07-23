import { DateTime } from "luxon";
import type {
  GoalDailyItemProgress,
  GoalDailyProgress,
  GoalTemplate,
  GoalTemplateItem,
  GoalRewardSettings,
} from "../types";

export interface GoalTemplateWithItems extends GoalTemplate {
  items: GoalTemplateItem[];
}

export function toLocalDateISO(base = DateTime.local()) {
  return base.toISODate()!;
}

export function occurredAtNoonUtc(localDateISO: string) {
  return DateTime.fromISO(localDateISO)
    .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    .toUTC()
    .toISO({ suppressMilliseconds: true })!;
}

export function keyByTemplateId(rows: GoalDailyProgress[]) {
  return rows.reduce<Record<string, GoalDailyProgress>>((acc, row) => {
    acc[row.template_id] = row;
    return acc;
  }, {});
}

export function keyByTemplateItemId(rows: GoalDailyItemProgress[]) {
  return rows.reduce<Record<string, GoalDailyItemProgress>>((acc, row) => {
    acc[row.template_item_id] = row;
    return acc;
  }, {});
}

export function isTemplateCompleted(
  template: GoalTemplateWithItems,
  progressByTemplateId: Record<string, GoalDailyProgress>,
  itemProgressByItemId: Record<string, GoalDailyItemProgress>,
) {
  const progress = progressByTemplateId[template.id];

  if (template.goal_kind === "number") {
    const current = progress?.numeric_value ?? 0;
    const target = template.target_value ?? 0;
    return current >= target;
  }

  if (template.items.length === 0) {
    return progress?.checked ?? template.default_checked;
  }

  return template.items.every(
    (item) => itemProgressByItemId[item.id]?.checked ?? item.default_checked,
  );
}

export function summarizeDay(
  templates: GoalTemplateWithItems[],
  progressByTemplateId: Record<string, GoalDailyProgress>,
  itemProgressByItemId: Record<string, GoalDailyItemProgress>,
) {
  const activeTemplates = templates.filter((template) => template.active);
  const completed = activeTemplates.filter((template) =>
    isTemplateCompleted(template, progressByTemplateId, itemProgressByItemId),
  ).length;
  const total = activeTemplates.length;
  return {
    completed,
    total,
    percent: total > 0 ? (completed / total) * 100 : 0,
    done: total > 0 && completed === total,
  };
}

export function isRewardEligible(
  settings: GoalRewardSettings | null,
  completedCount: number,
  totalCount: number,
) {
  if (!settings) return false;
  if (settings.threshold_mode === "count") {
    return completedCount >= settings.threshold_value;
  }
  if (totalCount <= 0) return false;
  return (completedCount / totalCount) * 100 >= settings.threshold_value;
}
