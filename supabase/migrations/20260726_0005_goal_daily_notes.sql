create table if not exists public.goal_daily_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  tz_offset_minutes integer not null,
  local_date date not null,
  note_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_daily_notes_tz_offset_range check (tz_offset_minutes between -840 and 840),
  constraint goal_daily_notes_text_length check (char_length(trim(note_text)) between 1 and 2000),
  unique (user_id, local_date)
);

drop trigger if exists trg_goal_daily_notes_local_date on public.goal_daily_notes;
create trigger trg_goal_daily_notes_local_date
before insert or update on public.goal_daily_notes
for each row execute function public.set_local_date_from_offset();

drop trigger if exists trg_goal_daily_notes_updated_at on public.goal_daily_notes;
create trigger trg_goal_daily_notes_updated_at
before update on public.goal_daily_notes
for each row execute function public.set_updated_at();

create index if not exists idx_goal_daily_notes_user_date
  on public.goal_daily_notes (user_id, local_date desc);

alter table public.goal_daily_notes enable row level security;

drop policy if exists "goal_daily_notes_select_own" on public.goal_daily_notes;
create policy "goal_daily_notes_select_own"
  on public.goal_daily_notes for select
  using (auth.uid() = user_id);

drop policy if exists "goal_daily_notes_upsert_own" on public.goal_daily_notes;
create policy "goal_daily_notes_upsert_own"
  on public.goal_daily_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
