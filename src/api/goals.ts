import { supabase } from "../lib/supabase";
import type {
  GoalDailyNote,
  GoalDailyItemProgress,
  GoalDailyProgress,
  GoalKind,
  GoalTemplate,
  GoalTemplateItem,
} from "../types";

export interface GoalTemplateWithItems extends GoalTemplate {
  items: GoalTemplateItem[];
}

export async function listGoalTemplates(userId: string): Promise<GoalTemplate[]> {
  const { data, error } = await supabase
    .from("goal_templates")
    .select("*")
    .eq("user_id", userId)
    .order("active", { ascending: false })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalTemplate[];
}

export async function listGoalTemplateItems(templateIds: string[]): Promise<GoalTemplateItem[]> {
  if (templateIds.length === 0) return [];
  const { data, error } = await supabase
    .from("goal_template_items")
    .select("*")
    .in("template_id", templateIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalTemplateItem[];
}

export async function listGoalTemplatesWithItems(userId: string): Promise<GoalTemplateWithItems[]> {
  const templates = await listGoalTemplates(userId);
  const items = await listGoalTemplateItems(templates.map((template) => template.id));
  const byTemplate: Record<string, GoalTemplateItem[]> = {};
  items.forEach((item) => {
    if (!byTemplate[item.template_id]) {
      byTemplate[item.template_id] = [];
    }
    byTemplate[item.template_id].push(item);
  });
  return templates.map((template) => ({
    ...template,
    items: byTemplate[template.id] ?? [],
  }));
}

export async function createGoalTemplate(input: {
  user_id: string;
  title: string;
  goal_kind: GoalKind;
  target_value: number | null;
  default_checked?: boolean;
  required_for_reward?: boolean;
  active?: boolean;
  display_order?: number;
}): Promise<GoalTemplate> {
  const { data, error } = await supabase
    .from("goal_templates")
    .insert([
      {
        ...input,
        title: input.title.trim(),
      },
    ])
    .select("*")
    .single();
  if (error) throw error;
  return data as GoalTemplate;
}

export async function updateGoalTemplate(
  id: string,
  patch: Partial<{
    title: string;
    goal_kind: GoalKind;
    target_value: number | null;
    default_checked: boolean;
    required_for_reward: boolean;
    active: boolean;
    display_order: number;
  }>,
): Promise<GoalTemplate> {
  const nextPatch = {
    ...patch,
    title: patch.title == null ? undefined : patch.title.trim(),
  };
  const { data, error } = await supabase
    .from("goal_templates")
    .update(nextPatch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as GoalTemplate;
}

export async function deleteGoalTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("goal_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function replaceGoalTemplateItems(
  templateId: string,
  items: Array<string | { label: string; default_checked?: boolean }>,
): Promise<void> {
  const cleanItems = items
    .map((item) => {
      if (typeof item === "string") {
        return { label: item.trim(), default_checked: false };
      }
      return {
        label: item.label.trim(),
        default_checked: Boolean(item.default_checked),
      };
    })
    .filter((item) => item.label.length > 0)
    .slice(0, 12);

  const { error: deleteError } = await supabase
    .from("goal_template_items")
    .delete()
    .eq("template_id", templateId);
  if (deleteError) throw deleteError;

  if (cleanItems.length === 0) return;

  const rows = cleanItems.map((item, index) => ({
    template_id: templateId,
    label: item.label,
    default_checked: item.default_checked,
    sort_order: index,
  }));
  const { error: insertError } = await supabase.from("goal_template_items").insert(rows);
  if (insertError) throw insertError;
}

export async function listGoalDailyProgressByDate(params: {
  user_id: string;
  local_date: string;
}): Promise<GoalDailyProgress[]> {
  const { data, error } = await supabase
    .from("goal_daily_progress")
    .select("*")
    .eq("user_id", params.user_id)
    .eq("local_date", params.local_date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalDailyProgress[];
}

export async function listGoalDailyProgressRange(params: {
  user_id: string;
  start_local_date: string;
  end_local_date: string;
}): Promise<GoalDailyProgress[]> {
  const { data, error } = await supabase
    .from("goal_daily_progress")
    .select("*")
    .eq("user_id", params.user_id)
    .gte("local_date", params.start_local_date)
    .lte("local_date", params.end_local_date)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalDailyProgress[];
}

export async function upsertGoalDailyProgress(input: {
  user_id: string;
  template_id: string;
  occurred_at: string;
  tz_offset_minutes: number;
  checked: boolean;
  numeric_value: number | null;
}): Promise<GoalDailyProgress> {
  const { data, error } = await supabase
    .from("goal_daily_progress")
    .upsert(input, { onConflict: "user_id,template_id,local_date" })
    .select("*")
    .single();
  if (error) throw error;
  return data as GoalDailyProgress;
}

export async function listGoalDailyItemProgressByDate(params: {
  user_id: string;
  local_date: string;
}): Promise<GoalDailyItemProgress[]> {
  const { data, error } = await supabase
    .from("goal_daily_item_progress")
    .select("*")
    .eq("user_id", params.user_id)
    .eq("local_date", params.local_date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalDailyItemProgress[];
}

export async function listGoalDailyItemProgressRange(params: {
  user_id: string;
  start_local_date: string;
  end_local_date: string;
}): Promise<GoalDailyItemProgress[]> {
  const { data, error } = await supabase
    .from("goal_daily_item_progress")
    .select("*")
    .eq("user_id", params.user_id)
    .gte("local_date", params.start_local_date)
    .lte("local_date", params.end_local_date)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalDailyItemProgress[];
}

export async function upsertGoalDailyItemProgress(input: {
  user_id: string;
  template_item_id: string;
  occurred_at: string;
  tz_offset_minutes: number;
  checked: boolean;
}): Promise<GoalDailyItemProgress> {
  const { data, error } = await supabase
    .from("goal_daily_item_progress")
    .upsert(input, { onConflict: "user_id,template_item_id,local_date" })
    .select("*")
    .single();
  if (error) throw error;
  return data as GoalDailyItemProgress;
}

export async function getGoalDailyNoteByDate(params: {
  user_id: string;
  local_date: string;
}): Promise<GoalDailyNote | null> {
  const { data, error } = await supabase
    .from("goal_daily_notes")
    .select("*")
    .eq("user_id", params.user_id)
    .eq("local_date", params.local_date)
    .maybeSingle();
  if (error) throw error;
  return (data as GoalDailyNote | null) ?? null;
}

export async function upsertGoalDailyNote(input: {
  user_id: string;
  occurred_at: string;
  tz_offset_minutes: number;
  note_text: string;
}): Promise<GoalDailyNote> {
  const noteText = input.note_text.trim();
  const { data, error } = await supabase
    .from("goal_daily_notes")
    .upsert(
      {
        ...input,
        note_text: noteText,
      },
      { onConflict: "user_id,local_date" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as GoalDailyNote;
}

export async function deleteGoalDailyNoteByDate(params: {
  user_id: string;
  local_date: string;
}): Promise<void> {
  const { error } = await supabase
    .from("goal_daily_notes")
    .delete()
    .eq("user_id", params.user_id)
    .eq("local_date", params.local_date);
  if (error) throw error;
}
