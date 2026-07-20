export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type FilterKind = "today" | "week" | "month" | "alltime";
export type GoalKind = "checkbox" | "number";
export type RewardThresholdMode = "count" | "percent";

export interface Entry {
  id: string;
  user_id: string;
  description: string;
  meal_type: MealType;
  occurred_at: string; // ISO UTC
  tz_offset_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  user_id: string;
  username: string | null;
  created_at: string;
  updated_at: string;
}

export interface Challenge {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
}

export interface ChallengeMember {
  id: string;
  challenge_id: string;
  user_id: string;
  start_weight_kg: number | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyMetric {
  id: string;
  challenge_id: string | null;
  user_id: string;
  weight_kg: number;
  steps: number | null;
  calories_burned: number | null;
  occurred_at: string; // ISO UTC
  tz_offset_minutes: number;
  local_date: string;
  created_at: string;
  updated_at: string;
}

export interface GoalTemplate {
  id: string;
  user_id: string;
  title: string;
  goal_kind: GoalKind;
  target_value: number | null;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface GoalTemplateItem {
  id: string;
  template_id: string;
  label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GoalDailyProgress {
  id: string;
  user_id: string;
  template_id: string;
  occurred_at: string;
  tz_offset_minutes: number;
  local_date: string;
  checked: boolean;
  numeric_value: number | null;
  created_at: string;
  updated_at: string;
}

export interface GoalDailyItemProgress {
  id: string;
  user_id: string;
  template_item_id: string;
  occurred_at: string;
  tz_offset_minutes: number;
  local_date: string;
  checked: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoalRewardSettings {
  user_id: string;
  reward_label: string;
  chance_percent: number;
  threshold_mode: RewardThresholdMode;
  threshold_value: number;
  created_at: string;
  updated_at: string;
}

export interface GoalRewardAttempt {
  id: string;
  user_id: string;
  occurred_at: string;
  tz_offset_minutes: number;
  local_date: string;
  eligible_goal_count: number;
  total_goal_count: number;
  threshold_mode: RewardThresholdMode;
  threshold_value: number;
  chance_percent: number;
  reward_label: string;
  rolled_value: number;
  did_win: boolean;
  redeemed_at: string | null;
  redeemed_note: string | null;
  created_at: string;
}
