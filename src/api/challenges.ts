import { supabase } from "../lib/supabase";
import type { Challenge, ChallengeMember } from "../types";

export async function getChallenge(id: string): Promise<Challenge | null> {
  const { data, error } = await supabase
    .from("challenges")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Challenge) ?? null;
}

export async function listChallengeMembers(
  challengeId: string,
): Promise<ChallengeMember[]> {
  const { data, error } = await supabase
    .from("challenge_members")
    .select("*")
    .eq("challenge_id", challengeId);
  if (error) throw error;
  return (data ?? []) as ChallengeMember[];
}

export async function getMyChallengeMember(
  challengeId: string,
  userId: string,
): Promise<ChallengeMember | null> {
  const { data, error } = await supabase
    .from("challenge_members")
    .select("*")
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChallengeMember) ?? null;
}

export async function joinChallenge(input: {
  challenge_id: string;
  user_id: string;
  start_weight_kg: number;
  display_name?: string;
}): Promise<ChallengeMember> {
  const { data, error } = await supabase
    .from("challenge_members")
    .insert([input])
    .select()
    .single();
  if (error) throw error;
  return data as ChallengeMember;
}

export async function updateMyChallengeDisplayName(
  challengeId: string,
  userId: string,
  displayName: string,
) {
  const { data, error } = await supabase
    .from("challenge_members")
    .update({ display_name: displayName.trim() })
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as ChallengeMember | null) ?? null;
}
