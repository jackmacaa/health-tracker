-- Health Tracker schema (entries with Monday-week client filtering)

create extension if not exists pgcrypto with schema public;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'meal_type') then
    create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');
  end if;
end$$;

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  meal_type public.meal_type not null,
  occurred_at timestamptz not null,
  tz_offset_minutes integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint description_length check (char_length(trim(description)) between 1 and 500),
  constraint tz_offset_range check (tz_offset_minutes between -840 and 840)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_entries_updated_at on public.entries;
create trigger trg_entries_updated_at
before update on public.entries
for each row execute function public.set_updated_at();

create index if not exists idx_entries_user_occurred_at
  on public.entries (user_id, occurred_at desc);

create index if not exists idx_entries_user_created_at
  on public.entries (user_id, created_at desc);

alter table public.entries enable row level security;

drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own"
  on public.entries for select
  using (auth.uid() = user_id);

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own"
  on public.entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own"
  on public.entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own"
  on public.entries for delete
  using (auth.uid() = user_id);

-- Lightweight fitness tracking (profiles, challenges, daily metrics)

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_length check (
    username is null or (char_length(trim(username)) between 3 and 30)
  )
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenge_window check (end_at > start_at)
);

drop trigger if exists trg_challenges_updated_at on public.challenges;
create trigger trg_challenges_updated_at
before update on public.challenges
for each row execute function public.set_updated_at();

create table if not exists public.challenge_members (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_weight_kg numeric(5,1),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint start_weight_positive check (start_weight_kg is null or start_weight_kg > 0),
  constraint display_name_length check (
    display_name is null or (char_length(trim(display_name)) between 3 and 40)
  ),
  unique (challenge_id, user_id)
);

drop trigger if exists trg_challenge_members_updated_at on public.challenge_members;
create trigger trg_challenge_members_updated_at
before update on public.challenge_members
for each row execute function public.set_updated_at();

create table if not exists public.daily_metrics (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_kg numeric(5,1) not null,
  steps integer,
  calories_burned integer,
  occurred_at timestamptz not null,
  tz_offset_minutes integer not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weight_positive check (weight_kg > 0),
  constraint steps_non_negative check (steps is null or steps >= 0),
  constraint calories_non_negative check (calories_burned is null or calories_burned >= 0),
  constraint tz_offset_range_metrics check (tz_offset_minutes between -840 and 840),
  unique (user_id, challenge_id, local_date)
);

create or replace function public.set_daily_metrics_local_date()
returns trigger language plpgsql as $$
begin
  new.local_date := (new.occurred_at + (new.tz_offset_minutes || ' minutes')::interval)::date;
  return new;
end$$;

drop trigger if exists trg_daily_metrics_local_date on public.daily_metrics;
create trigger trg_daily_metrics_local_date
before insert or update on public.daily_metrics
for each row execute function public.set_daily_metrics_local_date();

drop trigger if exists trg_daily_metrics_updated_at on public.daily_metrics;
create trigger trg_daily_metrics_updated_at
before update on public.daily_metrics
for each row execute function public.set_updated_at();

create index if not exists idx_challenge_members_challenge on public.challenge_members (challenge_id);
create index if not exists idx_daily_metrics_challenge_date on public.daily_metrics (challenge_id, local_date desc);
create index if not exists idx_daily_metrics_user_date on public.daily_metrics (user_id, local_date desc);

alter table public.profiles enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
alter table public.daily_metrics enable row level security;

-- Profiles: users can view/update their profile; everyone can read usernames for challenges via membership policy below
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own"
  on public.profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Challenges: allow read for authenticated users (admin-managed creation)
drop policy if exists "challenges_select_all" on public.challenges;
create policy "challenges_select_all"
  on public.challenges for select
  using (true);

-- Challenge members: authenticated users can view all; only edit own row
drop policy if exists "challenge_members_select_visible" on public.challenge_members;
create policy "challenge_members_select_all"
  on public.challenge_members for select
  using (true);

drop policy if exists "challenge_members_upsert_own" on public.challenge_members;
create policy "challenge_members_upsert_own"
  on public.challenge_members for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Daily metrics: participants can view metrics for challenges they are in; only edit their own rows
drop policy if exists "daily_metrics_select_visible" on public.daily_metrics;
create policy "daily_metrics_select_visible"
  on public.daily_metrics for select
  using (
    user_id = auth.uid()
    or challenge_id in (
      select cm.challenge_id from public.challenge_members cm where cm.user_id = auth.uid()
    )
  );

drop policy if exists "daily_metrics_upsert_own" on public.daily_metrics;
create policy "daily_metrics_upsert_own"
  on public.daily_metrics for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Personal daily goals tracking (independent of leaderboard/challenges)

create table if not exists public.goal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  goal_kind text not null,
  target_value integer,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_title_length check (char_length(trim(title)) between 1 and 120),
  constraint goal_kind_valid check (goal_kind in ('checkbox', 'number')),
  constraint goal_target_valid check (
    (goal_kind = 'checkbox' and target_value is null)
    or (goal_kind = 'number' and target_value is not null and target_value > 0)
  )
);

create table if not exists public.goal_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.goal_templates(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_item_label_length check (char_length(trim(label)) between 1 and 80),
  unique (template_id, sort_order)
);

create table if not exists public.goal_daily_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references public.goal_templates(id) on delete cascade,
  occurred_at timestamptz not null,
  tz_offset_minutes integer not null,
  local_date date not null,
  checked boolean not null default false,
  numeric_value integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_progress_tz_offset_range check (tz_offset_minutes between -840 and 840),
  constraint goal_progress_numeric_non_negative check (numeric_value is null or numeric_value >= 0),
  unique (user_id, template_id, local_date)
);

create table if not exists public.goal_daily_item_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_item_id uuid not null references public.goal_template_items(id) on delete cascade,
  occurred_at timestamptz not null,
  tz_offset_minutes integer not null,
  local_date date not null,
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_item_progress_tz_offset_range check (tz_offset_minutes between -840 and 840),
  unique (user_id, template_item_id, local_date)
);

create table if not exists public.goal_reward_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reward_label text not null,
  chance_percent numeric(5,2) not null,
  threshold_mode text not null,
  threshold_value numeric(6,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_label_length check (char_length(trim(reward_label)) between 1 and 120),
  constraint reward_chance_range check (chance_percent >= 0 and chance_percent <= 100),
  constraint reward_threshold_mode_valid check (threshold_mode in ('count', 'percent')),
  constraint reward_threshold_value_valid check (
    (threshold_mode = 'count' and threshold_value > 0)
    or (threshold_mode = 'percent' and threshold_value > 0 and threshold_value <= 100)
  )
);

create table if not exists public.goal_reward_attempts (
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
  reward_label text not null,
  rolled_value numeric(6,3) not null,
  did_win boolean not null,
  redeemed_at timestamptz,
  redeemed_note text,
  created_at timestamptz not null default now(),
  constraint reward_attempt_tz_offset_range check (tz_offset_minutes between -840 and 840),
  constraint reward_attempt_counts_valid check (
    eligible_goal_count >= 0 and total_goal_count >= 0 and eligible_goal_count <= total_goal_count
  ),
  constraint reward_attempt_threshold_mode_valid check (threshold_mode in ('count', 'percent')),
  constraint reward_attempt_threshold_value_valid check (
    (threshold_mode = 'count' and threshold_value > 0)
    or (threshold_mode = 'percent' and threshold_value > 0 and threshold_value <= 100)
  ),
  constraint reward_attempt_chance_range check (chance_percent >= 0 and chance_percent <= 100),
  constraint reward_attempt_roll_range check (rolled_value >= 0 and rolled_value <= 100),
  constraint reward_attempt_label_length check (char_length(trim(reward_label)) between 1 and 120),
  constraint reward_attempt_note_length check (
    redeemed_note is null or (char_length(trim(redeemed_note)) between 1 and 240)
  ),
  unique (user_id, local_date)
);

create or replace function public.set_local_date_from_offset()
returns trigger language plpgsql as $$
begin
  new.local_date := (new.occurred_at + (new.tz_offset_minutes || ' minutes')::interval)::date;
  return new;
end$$;

drop trigger if exists trg_goal_templates_updated_at on public.goal_templates;
create trigger trg_goal_templates_updated_at
before update on public.goal_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_goal_template_items_updated_at on public.goal_template_items;
create trigger trg_goal_template_items_updated_at
before update on public.goal_template_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_goal_daily_progress_local_date on public.goal_daily_progress;
create trigger trg_goal_daily_progress_local_date
before insert or update on public.goal_daily_progress
for each row execute function public.set_local_date_from_offset();

drop trigger if exists trg_goal_daily_progress_updated_at on public.goal_daily_progress;
create trigger trg_goal_daily_progress_updated_at
before update on public.goal_daily_progress
for each row execute function public.set_updated_at();

drop trigger if exists trg_goal_daily_item_progress_local_date on public.goal_daily_item_progress;
create trigger trg_goal_daily_item_progress_local_date
before insert or update on public.goal_daily_item_progress
for each row execute function public.set_local_date_from_offset();

drop trigger if exists trg_goal_daily_item_progress_updated_at on public.goal_daily_item_progress;
create trigger trg_goal_daily_item_progress_updated_at
before update on public.goal_daily_item_progress
for each row execute function public.set_updated_at();

drop trigger if exists trg_goal_reward_settings_updated_at on public.goal_reward_settings;
create trigger trg_goal_reward_settings_updated_at
before update on public.goal_reward_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_goal_reward_attempts_local_date on public.goal_reward_attempts;
create trigger trg_goal_reward_attempts_local_date
before insert or update on public.goal_reward_attempts
for each row execute function public.set_local_date_from_offset();

create index if not exists idx_goal_templates_user_order
  on public.goal_templates (user_id, active desc, display_order asc, created_at asc);
create index if not exists idx_goal_template_items_template
  on public.goal_template_items (template_id, sort_order asc);
create index if not exists idx_goal_daily_progress_user_date
  on public.goal_daily_progress (user_id, local_date desc);
create index if not exists idx_goal_daily_item_progress_user_date
  on public.goal_daily_item_progress (user_id, local_date desc);
create index if not exists idx_goal_reward_attempts_user_date
  on public.goal_reward_attempts (user_id, local_date desc);
create index if not exists idx_goal_reward_attempts_user_unredeemed
  on public.goal_reward_attempts (user_id, occurred_at asc)
  where did_win = true and redeemed_at is null;

alter table public.goal_templates enable row level security;
alter table public.goal_template_items enable row level security;
alter table public.goal_daily_progress enable row level security;
alter table public.goal_daily_item_progress enable row level security;
alter table public.goal_reward_settings enable row level security;
alter table public.goal_reward_attempts enable row level security;

drop policy if exists "goal_templates_select_own" on public.goal_templates;
create policy "goal_templates_select_own"
  on public.goal_templates for select
  using (auth.uid() = user_id);

drop policy if exists "goal_templates_upsert_own" on public.goal_templates;
create policy "goal_templates_upsert_own"
  on public.goal_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goal_template_items_select_own" on public.goal_template_items;
create policy "goal_template_items_select_own"
  on public.goal_template_items for select
  using (
    exists (
      select 1
      from public.goal_templates gt
      where gt.id = goal_template_items.template_id
        and gt.user_id = auth.uid()
    )
  );

drop policy if exists "goal_template_items_upsert_own" on public.goal_template_items;
create policy "goal_template_items_upsert_own"
  on public.goal_template_items for all
  using (
    exists (
      select 1
      from public.goal_templates gt
      where gt.id = goal_template_items.template_id
        and gt.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.goal_templates gt
      where gt.id = goal_template_items.template_id
        and gt.user_id = auth.uid()
    )
  );

drop policy if exists "goal_daily_progress_select_own" on public.goal_daily_progress;
create policy "goal_daily_progress_select_own"
  on public.goal_daily_progress for select
  using (auth.uid() = user_id);

drop policy if exists "goal_daily_progress_upsert_own" on public.goal_daily_progress;
create policy "goal_daily_progress_upsert_own"
  on public.goal_daily_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goal_daily_item_progress_select_own" on public.goal_daily_item_progress;
create policy "goal_daily_item_progress_select_own"
  on public.goal_daily_item_progress for select
  using (auth.uid() = user_id);

drop policy if exists "goal_daily_item_progress_upsert_own" on public.goal_daily_item_progress;
create policy "goal_daily_item_progress_upsert_own"
  on public.goal_daily_item_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goal_reward_settings_select_own" on public.goal_reward_settings;
create policy "goal_reward_settings_select_own"
  on public.goal_reward_settings for select
  using (auth.uid() = user_id);

drop policy if exists "goal_reward_settings_upsert_own" on public.goal_reward_settings;
create policy "goal_reward_settings_upsert_own"
  on public.goal_reward_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goal_reward_attempts_select_own" on public.goal_reward_attempts;
create policy "goal_reward_attempts_select_own"
  on public.goal_reward_attempts for select
  using (auth.uid() = user_id);

drop policy if exists "goal_reward_attempts_upsert_own" on public.goal_reward_attempts;
create policy "goal_reward_attempts_upsert_own"
  on public.goal_reward_attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
