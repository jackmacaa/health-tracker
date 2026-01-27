import { supabase } from "../lib/supabase";
import type { DailyMetric } from "../types";

export async function upsertDailyMetric(input: {
  user_id: string;
  challenge_id: string | null;
  occurred_at: string;
  tz_offset_minutes: number;
  weight_kg: number;
  steps: number | null;
  calories_burned: number | null;
}): Promise<DailyMetric> {
  const { data, error } = await supabase
    .from("daily_metrics")
    .upsert(input, { onConflict: "user_id,challenge_id,local_date" })
    .select()
    .single();
  if (error) throw error;
  return data as DailyMetric;
}

export async function deleteDailyMetric(id: string): Promise<void> {
  const { error } = await supabase.from("daily_metrics").delete().eq("id", id);
  if (error) throw error;
}

export async function listDailyMetricsInRange(params: {
  startUtcISO: string;
  endUtcISO: string;
  challenge_id?: string | null;
}): Promise<DailyMetric[]> {
  const { startUtcISO, endUtcISO, challenge_id } = params;
  let query = supabase
    .from("daily_metrics")
    .select("*")
    .gte("occurred_at", startUtcISO)
    .lt("occurred_at", endUtcISO)
    .order("occurred_at", { ascending: true });
  if (challenge_id !== undefined) {
    if (challenge_id === null) {
      query = query.is("challenge_id", null);
    } else {
      query = query.eq("challenge_id", challenge_id);
    }
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DailyMetric[];
}
