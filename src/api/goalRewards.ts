import { DateTime } from "luxon";
import { supabase } from "../lib/supabase";
import type { GoalRewardAttempt, GoalRewardSettings } from "../types";

export async function getGoalRewardSettings(userId: string): Promise<GoalRewardSettings | null> {
  const { data, error } = await supabase
    .from("goal_reward_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as GoalRewardSettings | null) ?? null;
}

export async function upsertGoalRewardSettings(input: {
  user_id: string;
  reward_label: string;
  chance_percent: number;
  threshold_mode: "count" | "percent";
  threshold_value: number;
}): Promise<GoalRewardSettings> {
  const { data, error } = await supabase
    .from("goal_reward_settings")
    .upsert(
      {
        ...input,
        reward_label: input.reward_label.trim(),
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as GoalRewardSettings;
}

export async function getGoalRewardAttemptByDate(params: {
  user_id: string;
  local_date: string;
}): Promise<GoalRewardAttempt | null> {
  const { data, error } = await supabase
    .from("goal_reward_attempts")
    .select("*")
    .eq("user_id", params.user_id)
    .eq("local_date", params.local_date)
    .maybeSingle();
  if (error) throw error;
  return (data as GoalRewardAttempt | null) ?? null;
}

export async function listGoalRewardAttemptsRange(params: {
  user_id: string;
  start_local_date: string;
  end_local_date: string;
}): Promise<GoalRewardAttempt[]> {
  const { data, error } = await supabase
    .from("goal_reward_attempts")
    .select("*")
    .eq("user_id", params.user_id)
    .gte("local_date", params.start_local_date)
    .lte("local_date", params.end_local_date)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalRewardAttempt[];
}

export async function listGoalRewardWins(params: {
  user_id: string;
  limit?: number;
}): Promise<GoalRewardAttempt[]> {
  const { data, error } = await supabase
    .from("goal_reward_attempts")
    .select("*")
    .eq("user_id", params.user_id)
    .eq("did_win", true)
    .order("occurred_at", { ascending: false })
    .limit(params.limit ?? 20);
  if (error) throw error;
  return (data ?? []) as GoalRewardAttempt[];
}

export async function countUnredeemedGoalRewards(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("goal_reward_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("did_win", true)
    .is("redeemed_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function redeemOldestGoalReward(input: {
  user_id: string;
  redeemed_note?: string | null;
}): Promise<GoalRewardAttempt> {
  const { data: oldest, error: oldestError } = await supabase
    .from("goal_reward_attempts")
    .select("id")
    .eq("user_id", input.user_id)
    .eq("did_win", true)
    .is("redeemed_at", null)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (oldestError) throw oldestError;
  if (!oldest) {
    throw new Error("No available rewards to redeem.");
  }

  const note = input.redeemed_note?.trim();
  const { data, error } = await supabase
    .from("goal_reward_attempts")
    .update({
      redeemed_at: DateTime.utc().toISO({ suppressMilliseconds: true }),
      redeemed_note: note && note.length > 0 ? note : null,
    })
    .eq("id", oldest.id)
    .eq("user_id", input.user_id)
    .is("redeemed_at", null)
    .select("*")
    .single();

  if (error) throw error;
  return data as GoalRewardAttempt;
}

export async function redeemGoalRewardsQuantity(input: {
  user_id: string;
  quantity: number;
  redeemed_note?: string | null;
}): Promise<number> {
  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be at least 1.");
  }

  const { data: rows, error: selectError } = await supabase
    .from("goal_reward_attempts")
    .select("id")
    .eq("user_id", input.user_id)
    .eq("did_win", true)
    .is("redeemed_at", null)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(quantity);

  if (selectError) throw selectError;
  const ids = (rows ?? []).map((row) => row.id as string);
  if (ids.length === 0) {
    throw new Error("No available rewards to redeem.");
  }

  const note = input.redeemed_note?.trim();
  const { data: updated, error: updateError } = await supabase
    .from("goal_reward_attempts")
    .update({
      redeemed_at: DateTime.utc().toISO({ suppressMilliseconds: true }),
      redeemed_note: note && note.length > 0 ? note : null,
    })
    .in("id", ids)
    .eq("user_id", input.user_id)
    .is("redeemed_at", null)
    .select("id");

  if (updateError) throw updateError;
  return updated?.length ?? 0;
}

function isEligible(params: {
  eligibleGoalCount: number;
  totalGoalCount: number;
  thresholdMode: "count" | "percent";
  thresholdValue: number;
}) {
  const { eligibleGoalCount, totalGoalCount, thresholdMode, thresholdValue } = params;
  if (thresholdMode === "count") {
    return eligibleGoalCount >= thresholdValue;
  }
  if (totalGoalCount <= 0) return false;
  const completionPercent = (eligibleGoalCount / totalGoalCount) * 100;
  return completionPercent >= thresholdValue;
}

export async function spinGoalRewardForToday(input: {
  user_id: string;
  tz_offset_minutes: number;
  occurred_at?: string;
  local_date?: string;
  settings: Pick<
    GoalRewardSettings,
    "reward_label" | "chance_percent" | "threshold_mode" | "threshold_value"
  >;
  eligible_goal_count: number;
  total_goal_count: number;
}): Promise<GoalRewardAttempt> {
  const occurredAt = input.occurred_at ?? DateTime.utc().toISO({ suppressMilliseconds: true })!;
  const localDate =
    input.local_date ??
    DateTime.fromISO(occurredAt, { zone: "utc" })
      .plus({ minutes: input.tz_offset_minutes })
      .toISODate()!;

  const existing = await getGoalRewardAttemptByDate({
    user_id: input.user_id,
    local_date: localDate,
  });
  if (existing) {
    throw new Error("Reward spin already used for this day.");
  }

  const eligible = isEligible({
    eligibleGoalCount: input.eligible_goal_count,
    totalGoalCount: input.total_goal_count,
    thresholdMode: input.settings.threshold_mode,
    thresholdValue: input.settings.threshold_value,
  });
  if (!eligible) {
    throw new Error("Not eligible for reward spin yet.");
  }

  const rolledValue = Number((Math.random() * 100).toFixed(3));
  const didWin = rolledValue < input.settings.chance_percent;

  const { data, error } = await supabase
    .from("goal_reward_attempts")
    .insert([
      {
        user_id: input.user_id,
        occurred_at: occurredAt,
        tz_offset_minutes: input.tz_offset_minutes,
        eligible_goal_count: input.eligible_goal_count,
        total_goal_count: input.total_goal_count,
        threshold_mode: input.settings.threshold_mode,
        threshold_value: input.settings.threshold_value,
        chance_percent: input.settings.chance_percent,
        reward_label: input.settings.reward_label.trim(),
        rolled_value: rolledValue,
        did_win: didWin,
      },
    ])
    .select("*")
    .single();

  if (error) {
    if (String(error.message).toLowerCase().includes("duplicate")) {
      throw new Error("Reward spin already used for this day.");
    }
    throw error;
  }

  return data as GoalRewardAttempt;
}
