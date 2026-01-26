import { supabase } from "../lib/supabase";
import type { MealType, Entry } from "../types";

export async function createEntry(input: {
  description: string;
  meal_type: MealType;
  occurred_at: string;
  tz_offset_minutes: number;
}): Promise<Entry> {
  const { data, error } = await supabase.from("entries").insert([input]).select().single();
  if (error) throw error;
  return data as Entry;
}

export async function listEntriesInRange(startUtcISO: string, endUtcISO: string): Promise<Entry[]> {
  const { data, error } = await supabase
    .from("entries")
    .select("*")
    .gte("occurred_at", startUtcISO)
    .lt("occurred_at", endUtcISO)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function updateEntry(
  id: string,
  patch: Partial<{
    description: string;
    meal_type: MealType;
    occurred_at: string;
    tz_offset_minutes: number;
  }>,
): Promise<Entry> {
  const { data, error } = await supabase
    .from("entries")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw error;
}
