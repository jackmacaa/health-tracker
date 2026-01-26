export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type FilterKind = "today" | "week" | "month";

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
