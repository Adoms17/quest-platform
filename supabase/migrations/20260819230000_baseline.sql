-- Quest Platform baseline
-- Reconstructed from the linked Supabase project on 2026-08-19.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists postgis with schema public;

create table public.profiles (
  id uuid not null,
  username text,
  avatar_url text,
  is_pro boolean default false,
  created_at timestamp with time zone default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_username_key unique (username)
);

create table public.quests (
  id uuid not null default gen_random_uuid(),
  creator_id uuid not null,
  title text not null,
  description text,
  is_public boolean default false,
  created_at timestamp with time zone default now(),
  location_options jsonb default '["gps"]'::jsonb,
  verification_options jsonb default '["gps"]'::jsonb,
  max_attempts integer default 0,
  is_open boolean default true,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  constraint quests_pkey primary key (id)
);

create table public.tasks (
  id uuid not null default gen_random_uuid(),
  quest_id uuid not null,
  title text not null,
  description text,
  hint text,
  gps_point geometry(Point,4326),
  static_code text,
  image_url text,
  required_photo_hash text,
  order_index integer default 0,
  correct_answer text,
  options jsonb,
  media_url text,
  location_text text,
  location_image_url text,
  media jsonb default '[]'::jsonb,
  constraint tasks_pkey primary key (id)
);

create table public.attempts (
  id uuid not null default gen_random_uuid(),
  participant_id uuid not null,
  task_id uuid not null,
  is_completed boolean default false,
  time_spent integer,
  submitted_at timestamp with time zone default now(),
  constraint attempts_pkey primary key (id)
);

create table public.quest_attempts (
  id uuid not null default gen_random_uuid(),
  quest_id uuid not null,
  user_id uuid not null,
  started_at timestamp with time zone default now(),
  finished_at timestamp with time zone,
  total_tasks integer not null,
  completed_tasks integer default 0,
  failed_tasks integer default 0,
  total_attempts integer default 0,
  total_time integer default 0,
  percent_success double precision default 0,
  created_at timestamp with time zone default now(),
  constraint quest_attempts_pkey primary key (id)
);

create table public.task_attempts (
  id uuid not null default gen_random_uuid(),
  quest_attempt_id uuid not null,
  task_id uuid not null,
  opened boolean default false,
  attempts_used integer default 0,
  completed boolean default false,
  failed boolean default false,
  time_spent integer default 0,
  created_at timestamp with time zone default now(),
  constraint task_attempts_pkey primary key (id)
);

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id);

alter table public.quests
  add constraint quests_creator_id_fkey
  foreign key (creator_id) references public.profiles(id) on delete cascade;

alter table public.tasks
  add constraint tasks_quest_id_fkey
  foreign key (quest_id) references public.quests(id) on delete cascade;

alter table public.attempts
  add constraint attempts_participant_id_fkey
  foreign key (participant_id) references public.profiles(id) on delete cascade;

alter table public.attempts
  add constraint attempts_task_id_fkey
  foreign key (task_id) references public.tasks(id) on delete cascade;

alter table public.quest_attempts
  add constraint quest_attempts_quest_id_fkey
  foreign key (quest_id) references public.quests(id) on delete cascade;

alter table public.quest_attempts
  add constraint quest_attempts_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.task_attempts
  add constraint task_attempts_quest_attempt_id_fkey
  foreign key (quest_attempt_id) references public.quest_attempts(id) on delete cascade;

alter table public.task_attempts
  add constraint task_attempts_task_id_fkey
  foreign key (task_id) references public.tasks(id) on delete cascade;

create index idx_quest_attempts_quest_id
  on public.quest_attempts using btree (quest_id);

create index idx_task_attempts_quest_attempt_id
  on public.task_attempts using btree (quest_attempt_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', new.email),
    null
  );
  return new;
exception
  when others then
    raise log 'Error creating profile for user %: %', new.id, sqlerrm;
    return new;
end;
$function$;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%'
    then
      begin
        execute format(
          'alter table if exists %s enable row level security',
          cmd.object_identity
        );
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log
        'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity,
        cmd.schema_name;
    end if;
  end loop;
end;
$function$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create event trigger ensure_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function public.rls_auto_enable();

alter table public.attempts enable row level security;
alter table public.profiles enable row level security;
alter table public.quest_attempts enable row level security;
alter table public.quests enable row level security;
alter table public.task_attempts enable row level security;
alter table public.tasks enable row level security;

create policy "Creators can view attempts for their quests"
on public.attempts
as permissive
for select
to public
using (
  exists (
    select 1
    from public.tasks
    join public.quests on quests.id = tasks.quest_id
    where tasks.id = attempts.task_id
      and quests.creator_id = auth.uid()
  )
);

create policy "No one can delete attempts"
on public.attempts
as permissive
for delete
to public
using (false);

create policy "Users can insert own attempts"
on public.attempts
as permissive
for insert
to public
with check (auth.uid() = participant_id);

create policy "Users can update own attempts"
on public.attempts
as permissive
for update
to public
using (auth.uid() = participant_id)
with check (auth.uid() = participant_id);

create policy "Users can view own attempts"
on public.attempts
as permissive
for select
to public
using (auth.uid() = participant_id);

create policy "Enable read access for all users"
on public.profiles
as permissive
for select
to public
using (true);

create policy "Users can update own profile"
on public.profiles
as permissive
for update
to public
using (auth.uid() = id);

create policy "Creators can delete quest_attempts for their quests"
on public.quest_attempts
as permissive
for delete
to public
using (
  exists (
    select 1
    from public.quests
    where quests.id = quest_attempts.quest_id
      and quests.creator_id = auth.uid()
  )
);

create policy "Creators can view quest_attempts for their quests"
on public.quest_attempts
as permissive
for select
to public
using (
  exists (
    select 1
    from public.quests
    where quests.id = quest_attempts.quest_id
      and quests.creator_id = auth.uid()
  )
);

create policy "Users can insert own quest_attempts"
on public.quest_attempts
as permissive
for insert
to public
with check (auth.uid() = user_id);

create policy "Users can update own quest_attempts"
on public.quest_attempts
as permissive
for update
to public
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can view own quest_attempts"
on public.quest_attempts
as permissive
for select
to public
using (auth.uid() = user_id);

create policy "Anyone can read public quests"
on public.quests
as permissive
for select
to public
using (is_public = true);

create policy "Creators can CRUD own quests"
on public.quests
as permissive
for all
to public
using (auth.uid() = creator_id);

create policy "Creators can delete task_attempts for their quests"
on public.task_attempts
as permissive
for delete
to public
using (
  exists (
    select 1
    from public.quest_attempts
    join public.quests on quests.id = quest_attempts.quest_id
    where quest_attempts.id = task_attempts.quest_attempt_id
      and quests.creator_id = auth.uid()
  )
);

create policy "Creators can view task_attempts for their quests"
on public.task_attempts
as permissive
for select
to public
using (
  exists (
    select 1
    from public.quest_attempts
    join public.quests on quests.id = quest_attempts.quest_id
    where quest_attempts.id = task_attempts.quest_attempt_id
      and quests.creator_id = auth.uid()
  )
);

create policy "Users can insert own task_attempts"
on public.task_attempts
as permissive
for insert
to public
with check (
  exists (
    select 1
    from public.quest_attempts
    where quest_attempts.id = task_attempts.quest_attempt_id
      and quest_attempts.user_id = auth.uid()
  )
);

create policy "Users can update own task_attempts"
on public.task_attempts
as permissive
for update
to public
using (
  exists (
    select 1
    from public.quest_attempts
    where quest_attempts.id = task_attempts.quest_attempt_id
      and quest_attempts.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.quest_attempts
    where quest_attempts.id = task_attempts.quest_attempt_id
      and quest_attempts.user_id = auth.uid()
  )
);

create policy "Users can view own task_attempts"
on public.task_attempts
as permissive
for select
to public
using (
  exists (
    select 1
    from public.quest_attempts
    where quest_attempts.id = task_attempts.quest_attempt_id
      and quest_attempts.user_id = auth.uid()
  )
);

create policy "Anyone can view tasks"
on public.tasks
as permissive
for select
to public
using (true);

create policy "Creators can manage tasks"
on public.tasks
as permissive
for all
to public
using (
  exists (
    select 1
    from public.quests
    where quests.id = tasks.quest_id
      and quests.creator_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.quests
    where quests.id = tasks.quest_id
      and quests.creator_id = auth.uid()
  )
);

grant all on table public.attempts to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;
grant all on table public.quest_attempts to anon, authenticated, service_role;
grant all on table public.quests to anon, authenticated, service_role;
grant all on table public.task_attempts to anon, authenticated, service_role;
grant all on table public.tasks to anon, authenticated, service_role;

grant execute on function public.handle_new_user()
  to public, anon, authenticated, service_role;

grant execute on function public.rls_auto_enable()
  to public, anon, authenticated, service_role;
