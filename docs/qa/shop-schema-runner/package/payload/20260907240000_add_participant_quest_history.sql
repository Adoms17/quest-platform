-- Participant history for self profiles and supervised dependent profiles.
-- The result intentionally contains aggregate progress only.

create or replace function public.get_participant_quest_history(
  p_participant_profile_id uuid
)
returns table (
  quest_attempt_id uuid,
  quest_id uuid,
  quest_title text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  total_tasks integer,
  completed_tasks integer,
  failed_tasks integer,
  total_attempts integer,
  total_time integer,
  percent_success double precision
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null
    or not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'participant history access denied';
  end if;

  return query
  select
    attempt.id,
    quest.id,
    quest.title,
    attempt.started_at,
    attempt.finished_at,
    attempt.total_tasks,
    attempt.completed_tasks,
    attempt.failed_tasks,
    attempt.total_attempts,
    attempt.total_time,
    attempt.percent_success
  from public.quest_attempts attempt
  join public.quests quest on quest.id = attempt.quest_id
  where attempt.participant_profile_id = p_participant_profile_id
  order by attempt.started_at desc, attempt.id desc;
end;
$$;

revoke all on function public.get_participant_quest_history(uuid) from public;
grant execute on function public.get_participant_quest_history(uuid) to authenticated;
