-- Phase 5: allow organizers to expose selected task coordinates as participant map hints.

alter table public.tasks
  add column show_location_on_map boolean not null default false;

drop function public.get_participant_tasks(uuid);

create function public.get_participant_tasks(p_quest_id uuid)
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
  code_verifier jsonb,
  location_latitude double precision,
  location_longitude double precision
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
      then tasks.code_client_verifier else null end,
    case when tasks.show_location_on_map and tasks.gps_point is not null
      then public.st_y(tasks.gps_point::public.geometry) else null end,
    case when tasks.show_location_on_map and tasks.gps_point is not null
      then public.st_x(tasks.gps_point::public.geometry) else null end
  from public.tasks
  join public.quests on quests.id = tasks.quest_id
  where tasks.quest_id = p_quest_id
  order by tasks.order_index, tasks.id;
end;
$function$;

revoke all on function public.get_participant_tasks(uuid) from public, anon;
grant execute on function public.get_participant_tasks(uuid) to authenticated;
grant execute on function public.get_participant_tasks(uuid) to service_role;

drop function public.get_participant_tasks_for_profile(uuid, uuid);

create function public.get_participant_tasks_for_profile(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
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
  code_verifier jsonb,
  location_latitude double precision,
  location_longitude double precision
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
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
      then tasks.code_client_verifier else null end,
    case when tasks.show_location_on_map and tasks.gps_point is not null
      then public.st_y(tasks.gps_point::public.geometry) else null end,
    case when tasks.show_location_on_map and tasks.gps_point is not null
      then public.st_x(tasks.gps_point::public.geometry) else null end
  from public.tasks
  join public.quests on quests.id = tasks.quest_id
  where tasks.quest_id = p_quest_id
  order by tasks.order_index, tasks.id;
end;
$function$;

revoke all on function public.get_participant_tasks_for_profile(uuid, uuid) from public, anon;
grant execute on function public.get_participant_tasks_for_profile(uuid, uuid) to authenticated;
grant execute on function public.get_participant_tasks_for_profile(uuid, uuid) to service_role;

