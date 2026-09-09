-- Phase 5 security review: return an explicit participant-safe quest projection.

create or replace function public.get_participant_quest(p_quest_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.can_access_quest(p_quest_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  select jsonb_build_object(
    'id', quest.id,
    'title', quest.title,
    'description', quest.description,
    'is_public', quest.is_public,
    'location_options', quest.location_options,
    'verification_options', quest.verification_options,
    'max_attempts', quest.max_attempts,
    'max_quest_attempts', quest.max_quest_attempts,
    'is_open', quest.is_open,
    'start_at', quest.start_at,
    'end_at', quest.end_at,
    'verification_mode', quest.verification_mode,
    'offline_progress_policy', quest.offline_progress_policy,
    'verification_match_policy', quest.verification_match_policy,
    'task_navigation_mode', quest.task_navigation_mode,
    'cover_image_url', quest.cover_image_url
  ) into result
  from public.quests quest
  where quest.id = p_quest_id;

  if result is null then
    raise exception using errcode = 'P0002', message = 'quest not found';
  end if;

  return result;
end;
$$;

create or replace function public.get_participant_quest_for_profile(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  select jsonb_build_object(
    'id', quest.id,
    'title', quest.title,
    'description', quest.description,
    'is_public', quest.is_public,
    'location_options', quest.location_options,
    'verification_options', quest.verification_options,
    'max_attempts', quest.max_attempts,
    'max_quest_attempts', quest.max_quest_attempts,
    'is_open', quest.is_open,
    'start_at', quest.start_at,
    'end_at', quest.end_at,
    'verification_mode', quest.verification_mode,
    'offline_progress_policy', quest.offline_progress_policy,
    'verification_match_policy', quest.verification_match_policy,
    'task_navigation_mode', quest.task_navigation_mode,
    'cover_image_url', quest.cover_image_url
  ) into result
  from public.quests quest
  where quest.id = p_quest_id;

  if result is null then
    raise exception using errcode = 'P0002', message = 'quest not found';
  end if;

  return result;
end;
$$;

revoke all on function public.get_participant_quest(uuid) from public, anon;
revoke all on function public.get_participant_quest_for_profile(uuid, uuid) from public, anon;
grant execute on function public.get_participant_quest(uuid) to authenticated, service_role;
grant execute on function public.get_participant_quest_for_profile(uuid, uuid) to authenticated, service_role;
