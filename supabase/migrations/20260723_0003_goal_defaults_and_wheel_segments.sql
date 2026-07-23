alter table public.goal_templates
  add column if not exists default_checked boolean not null default false;

alter table public.goal_template_items
  add column if not exists default_checked boolean not null default false;

alter table public.goal_reward_settings
  add column if not exists wheel_segment_count integer not null default 12;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reward_wheel_segments_valid'
      and conrelid = 'public.goal_reward_settings'::regclass
  ) then
    alter table public.goal_reward_settings
      add constraint reward_wheel_segments_valid check (wheel_segment_count between 2 and 72);
  end if;
end$$;
