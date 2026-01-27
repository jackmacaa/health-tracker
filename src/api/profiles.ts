import { supabase } from "../lib/supabase";
import type { Profile } from "../types";

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export async function upsertUsername(userId: string, username: string) {
  const trimmed = username.trim();
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, username: trimmed })
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}
