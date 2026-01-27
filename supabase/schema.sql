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
  start_weight_kg numeric(5,1) not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint start_weight_positive check (start_weight_kg > 0),
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
