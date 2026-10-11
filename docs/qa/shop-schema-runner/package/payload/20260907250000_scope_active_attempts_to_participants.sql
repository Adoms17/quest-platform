-- Replace the legacy actor-scoped active-attempt constraint. One account may
-- run the same quest for multiple participant profiles on a shared device,
-- while each participant still has at most one unfinished attempt per quest.

do $function$
begin
  if exists (
    select 1
    from public.quest_attempts
    where finished_at is null
    group by quest_id, participant_profile_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce one active participant quest attempt: duplicate active attempts exist';
  end if;
end;
$function$;

drop index if exists public.quest_attempts_one_active_per_user;

create unique index if not exists quest_attempts_one_active_per_participant
  on public.quest_attempts (quest_id, participant_profile_id)
  where finished_at is null;
