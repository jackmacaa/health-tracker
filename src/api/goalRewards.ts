import { DateTime } from "luxon";
import { supabase } from "../lib/supabase";
import type {
  GoalRewardAttempt,
  GoalRewardSettings,
  GoalRewardTokenBank,
  GoalSecondChanceAttempt,
  RewardThresholdMode,
} from "../types";

function toWholeTokenCount(fractionalBalance: number | null | undefined) {
  return Math.max(0, Math.floor(Number(fractionalBalance ?? 0)));
}

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
  wheel_segment_count: number;
  threshold_mode: "count" | "percent";
  threshold_value: number;
  second_chance_enabled: boolean;
  second_chance_label: string;
  second_chance_chance_percent: number;
  second_chance_threshold_mode: "count" | "percent";
  second_chance_threshold_value: number;
}): Promise<GoalRewardSettings> {
  const { data, error } = await supabase
    .from("goal_reward_settings")
    .upsert(
      {
        ...input,
        reward_label: input.reward_label.trim(),
        second_chance_label: input.second_chance_label.trim(),
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

export async function getGoalRewardTokenBank(userId: string): Promise<GoalRewardTokenBank | null> {
  const { data, error } = await supabase
    .from("goal_reward_token_bank")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as GoalRewardTokenBank | null) ?? null;
}

async function upsertTokenBankDelta(userId: string, delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;
  const current = await getGoalRewardTokenBank(userId);
  const nextBalance = Number(((current?.fractional_balance ?? 0) + delta).toFixed(4));
  if (nextBalance < 0) {
    throw new Error("Not enough token balance.");
  }

  const { error } = await supabase.from("goal_reward_token_bank").upsert(
    {
      user_id: userId,
      fractional_balance: nextBalance,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function getGoalSecondChanceAttemptByDate(params: {
  user_id: string;
  local_date: string;
}): Promise<GoalSecondChanceAttempt | null> {
  const { data, error } = await supabase
    .from("goal_second_chance_attempts")
    .select("*")
    .eq("user_id", params.user_id)
    .eq("local_date", params.local_date)
    .maybeSingle();
  if (error) throw error;
  return (data as GoalSecondChanceAttempt | null) ?? null;
}

export async function listGoalSecondChanceAttemptsRange(params: {
  user_id: string;
  start_local_date: string;
  end_local_date: string;
}): Promise<GoalSecondChanceAttempt[]> {
  const { data, error } = await supabase
    .from("goal_second_chance_attempts")
    .select("*")
    .eq("user_id", params.user_id)
    .gte("local_date", params.start_local_date)
    .lte("local_date", params.end_local_date)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalSecondChanceAttempt[];
}

export async function countUnredeemedGoalRewards(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("goal_reward_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("did_win", true)
    .is("redeemed_at", null);
  if (error) throw error;
  const bank = await getGoalRewardTokenBank(userId);
  return (count ?? 0) + toWholeTokenCount(bank?.fractional_balance);
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

  const { count: winCount, error: winCountError } = await supabase
    .from("goal_reward_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.user_id)
    .eq("did_win", true)
    .is("redeemed_at", null);
  if (winCountError) throw winCountError;

  const bank = await getGoalRewardTokenBank(input.user_id);
  const bankWhole = toWholeTokenCount(bank?.fractional_balance);
  const available = (winCount ?? 0) + bankWhole;
  if (available < quantity) {
    throw new Error("Not enough whole tokens available to redeem.");
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

  const note = input.redeemed_note?.trim();
  let redeemedCount = 0;
  if (ids.length > 0) {
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
    redeemedCount += updated?.length ?? 0;
  }

  const remainingFromBank = quantity - redeemedCount;
  if (remainingFromBank > 0) {
    await upsertTokenBankDelta(input.user_id, -remainingFromBank);
    redeemedCount += remainingFromBank;
  }

  return redeemedCount;
}

function isEligible(params: {
  eligibleGoalCount: number;
  totalGoalCount: number;
  thresholdMode: RewardThresholdMode;
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

function resolveOccurredAtForLocalDate(input: {
  occurred_at?: string;
  local_date?: string;
  tz_offset_minutes: number;
}) {
  if (!input.local_date) {
    return input.occurred_at ?? DateTime.utc().toISO({ suppressMilliseconds: true })!;
  }

  return DateTime.fromISO(`${input.local_date}T12:00:00`, { zone: "utc" })
    .minus({ minutes: input.tz_offset_minutes })
    .toISO({ suppressMilliseconds: true })!;
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
  required_goals_completed?: boolean;
}): Promise<GoalRewardAttempt> {
  const occurredAt = resolveOccurredAtForLocalDate(input);
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

  if (!input.required_goals_completed) {
    throw new Error("Complete all required goals to unlock reward spin.");
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

interface SecondChanceInput {
  user_id: string;
  tz_offset_minutes: number;
  local_date?: string;
  occurred_at?: string;
  settings: Pick<
    GoalRewardSettings,
    | "second_chance_label"
    | "second_chance_chance_percent"
    | "second_chance_threshold_mode"
    | "second_chance_threshold_value"
    | "second_chance_enabled"
  >;
  eligible_goal_count: number;
  total_goal_count: number;
  required_goals_completed?: boolean;
}

function resolveLocalDate(input: {
  occurred_at?: string;
  local_date?: string;
  tz_offset_minutes: number;
}) {
  const occurredAt = input.occurred_at ?? DateTime.utc().toISO({ suppressMilliseconds: true })!;
  const localDate =
    input.local_date ??
    DateTime.fromISO(occurredAt, { zone: "utc" })
      .plus({ minutes: input.tz_offset_minutes })
      .toISODate()!;
  return { occurredAt, localDate };
}

function getSecondChanceBankFraction(chancePercent: number) {
  const safeChance = Math.max(0, Math.min(100, chancePercent));
  return Number((safeChance / 100).toFixed(4));
}

function assertSecondChanceEligibility(input: SecondChanceInput) {
  if (!input.settings.second_chance_enabled) {
    throw new Error("Second chance is disabled in reward settings.");
  }
  if (!input.required_goals_completed) {
    throw new Error("Complete all required goals to unlock second chance.");
  }

  const eligible = isEligible({
    eligibleGoalCount: input.eligible_goal_count,
    totalGoalCount: input.total_goal_count,
    thresholdMode: input.settings.second_chance_threshold_mode,
    thresholdValue: input.settings.second_chance_threshold_value,
  });
  if (!eligible) {
    throw new Error("Not eligible for second chance yet.");
  }
}

export async function spinSecondChanceForDate(
  input: SecondChanceInput,
): Promise<GoalSecondChanceAttempt> {
  const { occurredAt, localDate } = resolveLocalDate(input);

  const existing = await getGoalSecondChanceAttemptByDate({
    user_id: input.user_id,
    local_date: localDate,
  });
  if (existing) {
    throw new Error("Second chance already used for this day.");
  }

  assertSecondChanceEligibility(input);

  const rolledValue = Number((Math.random() * 100).toFixed(3));
  const didWin = rolledValue < input.settings.second_chance_chance_percent;
  const awardedFraction = didWin ? 1 : 0;

  const { data, error } = await supabase
    .from("goal_second_chance_attempts")
    .insert([
      {
        user_id: input.user_id,
        occurred_at: occurredAt,
        tz_offset_minutes: input.tz_offset_minutes,
        local_date: localDate,
        eligible_goal_count: input.eligible_goal_count,
        total_goal_count: input.total_goal_count,
        threshold_mode: input.settings.second_chance_threshold_mode,
        threshold_value: input.settings.second_chance_threshold_value,
        chance_percent: input.settings.second_chance_chance_percent,
        action: "spin",
        rolled_value: rolledValue,
        did_win: didWin,
        awarded_fraction: awardedFraction,
      },
    ])
    .select("*")
    .single();

  if (error) {
    if (String(error.message).toLowerCase().includes("duplicate")) {
      throw new Error("Second chance already used for this day.");
    }
    throw error;
  }

  if (awardedFraction > 0) {
    await upsertTokenBankDelta(input.user_id, awardedFraction);
  }

  return data as GoalSecondChanceAttempt;
}

export async function bankSecondChanceForDate(
  input: SecondChanceInput,
): Promise<GoalSecondChanceAttempt> {
  const { occurredAt, localDate } = resolveLocalDate(input);

  const existing = await getGoalSecondChanceAttemptByDate({
    user_id: input.user_id,
    local_date: localDate,
  });
  if (existing) {
    throw new Error("Second chance already used for this day.");
  }

  assertSecondChanceEligibility(input);

  const awardedFraction = getSecondChanceBankFraction(input.settings.second_chance_chance_percent);

  const { data, error } = await supabase
    .from("goal_second_chance_attempts")
    .insert([
      {
        user_id: input.user_id,
        occurred_at: occurredAt,
        tz_offset_minutes: input.tz_offset_minutes,
        local_date: localDate,
        eligible_goal_count: input.eligible_goal_count,
        total_goal_count: input.total_goal_count,
        threshold_mode: input.settings.second_chance_threshold_mode,
        threshold_value: input.settings.second_chance_threshold_value,
        chance_percent: input.settings.second_chance_chance_percent,
        action: "bank",
        rolled_value: null,
        did_win: false,
        awarded_fraction: awardedFraction,
      },
    ])
    .select("*")
    .single();
  if (error) throw error;

  if (awardedFraction > 0) {
    await upsertTokenBankDelta(input.user_id, awardedFraction);
  }

  return data as GoalSecondChanceAttempt;
}

export async function settleSecondChanceAutoBank(input: {
  user_id: string;
  entries: Array<{
    local_date: string;
    tz_offset_minutes: number;
    eligible_goal_count: number;
    total_goal_count: number;
    threshold_mode: RewardThresholdMode;
    threshold_value: number;
    chance_percent: number;
    required_goals_completed: boolean;
  }>;
}): Promise<number> {
  if (input.entries.length === 0) return 0;

  const sorted = [...input.entries].sort((a, b) => a.local_date.localeCompare(b.local_date));
  const start = sorted[0].local_date;
  const end = sorted[sorted.length - 1].local_date;

  const existingRows = await listGoalSecondChanceAttemptsRange({
    user_id: input.user_id,
    start_local_date: start,
    end_local_date: end,
  });
  const attemptedDates = new Set(existingRows.map((row) => row.local_date));

  const toInsert = sorted.filter((entry) => {
    if (attemptedDates.has(entry.local_date)) return false;
    if (!entry.required_goals_completed) return false;
    return isEligible({
      eligibleGoalCount: entry.eligible_goal_count,
      totalGoalCount: entry.total_goal_count,
      thresholdMode: entry.threshold_mode,
      thresholdValue: entry.threshold_value,
    });
  });

  if (toInsert.length === 0) return 0;

  const rows = toInsert.map((entry) => {
    const occurredAt = DateTime.fromISO(entry.local_date)
      .toLocal()
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
      .toUTC()
      .toISO({ suppressMilliseconds: true })!;
    const awardedFraction = getSecondChanceBankFraction(entry.chance_percent);
    return {
      user_id: input.user_id,
      occurred_at: occurredAt,
      tz_offset_minutes: entry.tz_offset_minutes,
      local_date: entry.local_date,
      eligible_goal_count: entry.eligible_goal_count,
      total_goal_count: entry.total_goal_count,
      threshold_mode: entry.threshold_mode,
      threshold_value: entry.threshold_value,
      chance_percent: entry.chance_percent,
      action: "auto_bank",
      rolled_value: null,
      did_win: false,
      awarded_fraction: awardedFraction,
    };
  });

  const { error } = await supabase.from("goal_second_chance_attempts").insert(rows);
  if (error) throw error;

  const addedFraction = rows.reduce((acc, row) => acc + Number(row.awarded_fraction ?? 0), 0);
  if (addedFraction > 0) {
    await upsertTokenBankDelta(input.user_id, Number(addedFraction.toFixed(4)));
  }

  return rows.length;
}
