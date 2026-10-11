-- Switch administrative access from quest creator checks to organization permissions.

create or replace function public.has_quest_permission(
  target_quest_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.quests quest
    where quest.id = target_quest_id
      and public.has_organization_permission(quest.organization_id, required_permission)
  );
$$;

create or replace function public.can_access_quest(target_quest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.quests quest
      where quest.id = target_quest_id
        and (
          quest.is_public
          or public.has_organization_permission(quest.organization_id, 'quests.read')
        )
    );
$$;

revoke all on function public.has_quest_permission(uuid, text) from public;
revoke all on function public.can_access_quest(uuid) from public;
grant execute on function public.has_quest_permission(uuid, text) to authenticated;
grant execute on function public.can_access_quest(uuid) to authenticated;

drop policy if exists "Creators can CRUD own quests" on public.quests;

create policy "Members can read organization quests"
on public.quests for select to authenticated
using (public.has_organization_permission(organization_id, 'quests.read'));

create policy "Members can create organization quests"
on public.quests for insert to authenticated
with check (
  creator_id = auth.uid()
  and public.has_organization_permission(organization_id, 'quests.create')
);

create policy "Members can update organization quests"
on public.quests for update to authenticated
using (public.has_organization_permission(organization_id, 'quests.update'))
with check (public.has_organization_permission(organization_id, 'quests.update'));

create policy "Members can delete organization quests"
on public.quests for delete to authenticated
using (public.has_organization_permission(organization_id, 'quests.delete'));

drop policy if exists "Creators can manage tasks" on public.tasks;

create policy "Members can manage organization quest tasks"
on public.tasks for all to authenticated
using (public.has_quest_permission(quest_id, 'quests.update'))
with check (public.has_quest_permission(quest_id, 'quests.update'));

drop policy if exists "Creators can view quest_attempts for their quests"
  on public.quest_attempts;
drop policy if exists "Creators can delete quest_attempts for their quests"
  on public.quest_attempts;

create policy "Members can view organization quest attempts"
on public.quest_attempts for select to authenticated
using (public.has_quest_permission(quest_id, 'quest_stats.read'));

create policy "Members can delete organization quest attempts"
on public.quest_attempts for delete to authenticated
using (public.has_quest_permission(quest_id, 'quest_stats.delete'));

drop policy if exists "Creators can view task_attempts for their quests"
  on public.task_attempts;
drop policy if exists "Creators can delete task_attempts for their quests"
  on public.task_attempts;

create policy "Members can view organization task attempts"
on public.task_attempts for select to authenticated
using (
  exists (
    select 1
    from public.quest_attempts quest_attempt
    where quest_attempt.id = task_attempts.quest_attempt_id
      and public.has_quest_permission(quest_attempt.quest_id, 'quest_stats.read')
  )
);

create policy "Members can delete organization task attempts"
on public.task_attempts for delete to authenticated
using (
  exists (
    select 1
    from public.quest_attempts quest_attempt
    where quest_attempt.id = task_attempts.quest_attempt_id
      and public.has_quest_permission(quest_attempt.quest_id, 'quest_stats.delete')
  )
);

drop policy if exists "Creators can view participant profiles" on public.profiles;

create policy "Members can view organization participant profiles"
on public.profiles for select to authenticated
using (
  exists (
    select 1
    from public.quest_attempts quest_attempt
    where quest_attempt.user_id = profiles.id
      and public.has_quest_permission(quest_attempt.quest_id, 'participants.read')
  )
);

create or replace function public.get_participant_tasks(p_quest_id uuid)
returns table (
  id uuid,
  quest_id uuid,
  title text,
  description text,
  hint text,
  image_url text,
  order_index integer,
  options jsonb,
  media_url text,
  location_text text,
  location_image_url text,
  media jsonb,
  requires_answer boolean,
  requires_code boolean,
  requires_gps boolean,
  answer_verifier jsonb,
  code_verifier jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.can_access_quest(p_quest_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  return query
  select
    tasks.id,
    tasks.quest_id,
    tasks.title,
    tasks.description,
    tasks.hint,
    tasks.image_url,
    tasks.order_index,
    tasks.options,
    tasks.media_url,
    tasks.location_text,
    tasks.location_image_url,
    tasks.media,
    nullif(btrim(tasks.correct_answer), '') is not null,
    (quests.verification_options ? 'code')
      and nullif(btrim(tasks.static_code), '') is not null,
    (quests.verification_options ? 'gps')
      and tasks.gps_point is not null,
    case when quests.verification_mode = 'hybrid'
      then tasks.answer_client_verifier else null end,
    case when quests.verification_mode = 'hybrid'
      then tasks.code_client_verifier else null end
  from public.tasks
  join public.quests on quests.id = tasks.quest_id
  where tasks.quest_id = p_quest_id
  order by tasks.order_index, tasks.id;
end;
$function$;

create or replace function public.start_quest_attempt(p_quest_id uuid)
returns table (
  id uuid,
  quest_id uuid,
  user_id uuid,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  total_tasks integer,
  completed_tasks integer,
  failed_tasks integer,
  total_attempts integer,
  total_time integer,
  percent_success double precision
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  quest_record public.quests%rowtype;
  attempt_record public.quest_attempts%rowtype;
  task_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select *
  into quest_record
  from public.quests
  where quests.id = p_quest_id;

  if not found or not public.can_access_quest(p_quest_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  if not coalesce(quest_record.is_open, true)
     or (quest_record.start_at is not null and quest_record.start_at > now())
     or (quest_record.end_at is not null and quest_record.end_at < now())
  then
    raise exception using errcode = '23514', message = 'quest is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || p_quest_id::text, 0)
  );

  select *
  into attempt_record
  from public.quest_attempts
  where quest_attempts.quest_id = p_quest_id
    and quest_attempts.user_id = current_user_id
    and quest_attempts.finished_at is null
  for update;

  if not found then
    select count(*)::integer
    into task_count
    from public.tasks
    where tasks.quest_id = p_quest_id;

    insert into public.quest_attempts (quest_id, user_id, total_tasks)
    values (p_quest_id, current_user_id, task_count)
    returning * into attempt_record;
  end if;

  return query
  select
    attempt_record.id,
    attempt_record.quest_id,
    attempt_record.user_id,
    attempt_record.started_at,
    attempt_record.finished_at,
    attempt_record.total_tasks,
    attempt_record.completed_tasks,
    attempt_record.failed_tasks,
    attempt_record.total_attempts,
    attempt_record.total_time,
    attempt_record.percent_success;
end;
$function$;

