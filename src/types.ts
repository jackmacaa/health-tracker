export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type FilterKind = "today" | "week" | "month" | "alltime";

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
