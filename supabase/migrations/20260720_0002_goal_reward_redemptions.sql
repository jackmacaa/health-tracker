alter table public.goal_reward_attempts
  add column if not exists redeemed_at timestamptz,
  add column if not exists redeemed_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reward_attempt_note_length'
      and conrelid = 'public.goal_reward_attempts'::regclass
  ) then
    alter table public.goal_reward_attempts
      add constraint reward_attempt_note_length check (
        redeemed_note is null or (char_length(trim(redeemed_note)) between 1 and 240)
      );
  end if;
end$$;

create index if not exists idx_goal_reward_attempts_user_unredeemed
  on public.goal_reward_attempts (user_id, occurred_at asc)
  where did_win = true and redeemed_at is null;
