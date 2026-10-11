-- Expose only the display labels needed by quest statistics.
-- Full participant profiles remain protected by their existing RLS policies.

create or replace function public.get_quest_participant_labels(p_quest_id uuid)
returns table (participant_profile_id uuid, display_name text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.quests quest
    where quest.id = p_quest_id
      and quest.creator_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'quest statistics access denied';
  end if;

  return query
  select distinct participant.id, participant.display_name
  from public.quest_attempts attempt
  join public.participant_profiles participant
    on participant.id = attempt.participant_profile_id
  where attempt.quest_id = p_quest_id;
end;
$$;

revoke all on function public.get_quest_participant_labels(uuid) from public;
grant execute on function public.get_quest_participant_labels(uuid) to authenticated;
