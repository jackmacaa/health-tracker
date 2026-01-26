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
