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

function wasCreatedOnOrBeforeLocalDate(createdAt: string, localDate: string) {
  const createdLocalDate = DateTime.fromISO(createdAt).toLocal().toISODate();
  return createdLocalDate == null || createdLocalDate <= localDate;
}

export function getActiveTemplatesForDate(templates: GoalTemplateWithItems[], localDate: string) {
  return templates
    .filter(
      (template) =>
        template.active && wasCreatedOnOrBeforeLocalDate(template.created_at, localDate),
    )
    .map((template) => ({
      ...template,
      items: template.items.filter((item) =>
        wasCreatedOnOrBeforeLocalDate(item.created_at, localDate),
      ),
    }));
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
  localDate?: string,
) {
  const activeTemplates = localDate
    ? getActiveTemplatesForDate(templates, localDate)
    : templates.filter((template) => template.active);
  const completed = activeTemplates.filter((template) =>
    isTemplateCompleted(template, progressByTemplateId, itemProgressByItemId),
  ).length;
  const total = activeTemplates.length;
  const requiredTemplates = activeTemplates.filter((template) => template.required_for_reward);
  const requiredCompleted = requiredTemplates.filter((template) =>
    isTemplateCompleted(template, progressByTemplateId, itemProgressByItemId),
  ).length;
  return {
    completed,
    total,
    requiredCompleted,
    requiredTotal: requiredTemplates.length,
    requiredDone: requiredTemplates.length === 0 || requiredCompleted === requiredTemplates.length,
    percent: total > 0 ? (completed / total) * 100 : 0,
    done: total > 0 && completed === total,
  };
}

export function areRequiredGoalsCompleted(
  templates: GoalTemplateWithItems[],
  progressByTemplateId: Record<string, GoalDailyProgress>,
  itemProgressByItemId: Record<string, GoalDailyItemProgress>,
  localDate?: string,
) {
  const activeTemplates = localDate
    ? getActiveTemplatesForDate(templates, localDate)
    : templates.filter((template) => template.active);

  const requiredTemplates = activeTemplates.filter((template) => template.required_for_reward);
  if (requiredTemplates.length === 0) return true;

  return requiredTemplates.every((template) =>
    isTemplateCompleted(template, progressByTemplateId, itemProgressByItemId),
  );
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
