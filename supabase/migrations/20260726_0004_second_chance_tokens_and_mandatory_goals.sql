alter table public.goal_templates
  add column if not exists required_for_reward boolean not null default false;

alter table public.goal_reward_settings
  add column if not exists second_chance_enabled boolean not null default true,
  add column if not exists second_chance_label text not null default 'Second chance spin',
  add column if not exists second_chance_chance_percent numeric(5,2) not null default 10,
  add column if not exists second_chance_threshold_mode text not null default 'percent',
  add column if not exists second_chance_threshold_value numeric(6,2) not null default 75;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reward_second_chance_label_length'
      and conrelid = 'public.goal_reward_settings'::regclass
  ) then
    alter table public.goal_reward_settings
      add constraint reward_second_chance_label_length check (
        char_length(trim(second_chance_label)) between 1 and 120
      );
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reward_second_chance_chance_range'
      and conrelid = 'public.goal_reward_settings'::regclass
  ) then
    alter table public.goal_reward_settings
      add constraint reward_second_chance_chance_range check (
        second_chance_chance_percent >= 0 and second_chance_chance_percent <= 100
      );
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reward_second_chance_threshold_mode_valid'
      and conrelid = 'public.goal_reward_settings'::regclass
  ) then
    alter table public.goal_reward_settings
      add constraint reward_second_chance_threshold_mode_valid check (
        second_chance_threshold_mode in ('count', 'percent')
      );
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reward_second_chance_threshold_value_valid'
      and conrelid = 'public.goal_reward_settings'::regclass
  ) then
    alter table public.goal_reward_settings
      add constraint reward_second_chance_threshold_value_valid check (
        (second_chance_threshold_mode = 'count' and second_chance_threshold_value > 0)
        or (
          second_chance_threshold_mode = 'percent'
          and second_chance_threshold_value > 0
          and second_chance_threshold_value <= 100
        )
      );
  end if;
end$$;

create table if not exists public.goal_reward_token_bank (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fractional_balance numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_reward_token_bank_balance_non_negative check (fractional_balance >= 0)
);

create table if not exists public.goal_second_chance_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  tz_offset_minutes integer not null,
  local_date date not null,
  eligible_goal_count integer not null,
  total_goal_count integer not null,
  threshold_mode text not null,
  threshold_value numeric(6,2) not null,
  chance_percent numeric(5,2) not null,
  action text not null,
  rolled_value numeric(6,3),
  did_win boolean not null,
  awarded_fraction numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  constraint second_chance_tz_offset_range check (tz_offset_minutes between -840 and 840),
  constraint second_chance_counts_valid check (
    eligible_goal_count >= 0 and total_goal_count >= 0 and eligible_goal_count <= total_goal_count
  ),
  constraint second_chance_threshold_mode_valid check (threshold_mode in ('count', 'percent')),
  constraint second_chance_threshold_value_valid check (
    (threshold_mode = 'count' and threshold_value > 0)
    or (threshold_mode = 'percent' and threshold_value > 0 and threshold_value <= 100)
  ),
  constraint second_chance_chance_range check (chance_percent >= 0 and chance_percent <= 100),
  constraint second_chance_action_valid check (action in ('spin', 'bank', 'auto_bank')),
  constraint second_chance_roll_range check (rolled_value is null or (rolled_value >= 0 and rolled_value <= 100)),
  constraint second_chance_awarded_non_negative check (awarded_fraction >= 0),
  unique (user_id, local_date)
);

drop trigger if exists trg_goal_reward_token_bank_updated_at on public.goal_reward_token_bank;
create trigger trg_goal_reward_token_bank_updated_at
before update on public.goal_reward_token_bank
for each row execute function public.set_updated_at();

drop trigger if exists trg_goal_second_chance_attempts_local_date on public.goal_second_chance_attempts;
create trigger trg_goal_second_chance_attempts_local_date
before insert or update on public.goal_second_chance_attempts
for each row execute function public.set_local_date_from_offset();

create index if not exists idx_goal_second_chance_attempts_user_date
  on public.goal_second_chance_attempts (user_id, local_date desc);

alter table public.goal_reward_token_bank enable row level security;
alter table public.goal_second_chance_attempts enable row level security;

drop policy if exists "goal_reward_token_bank_select_own" on public.goal_reward_token_bank;
create policy "goal_reward_token_bank_select_own"
  on public.goal_reward_token_bank for select
  using (auth.uid() = user_id);

drop policy if exists "goal_reward_token_bank_upsert_own" on public.goal_reward_token_bank;
create policy "goal_reward_token_bank_upsert_own"
  on public.goal_reward_token_bank for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goal_second_chance_attempts_select_own" on public.goal_second_chance_attempts;
create policy "goal_second_chance_attempts_select_own"
  on public.goal_second_chance_attempts for select
  using (auth.uid() = user_id);

drop policy if exists "goal_second_chance_attempts_upsert_own" on public.goal_second_chance_attempts;
create policy "goal_second_chance_attempts_upsert_own"
  on public.goal_second_chance_attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
