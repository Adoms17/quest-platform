-- Organization roles manage quests but do not grant participant play access.

create or replace function public.can_access_quest(target_quest_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.quests quest
    where quest.id = target_quest_id and (
      quest.is_public
      or exists (
        select 1 from public.quest_access_grants access_grant
        where access_grant.quest_id = quest.id
          and access_grant.user_id = auth.uid()
          and access_grant.status = 'active'
          and (access_grant.expires_at is null or access_grant.expires_at > now())
      )
    )
  );
$$;

create policy "Participants can read accessible quest metadata"
on public.quests for select to authenticated
using (public.can_access_quest(id));

create or replace function public.enforce_task_event_quest_access()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare target_quest_id uuid;
begin
  select attempt.quest_id into target_quest_id
  from public.quest_attempts attempt
  where attempt.id = new.quest_attempt_id and attempt.user_id = auth.uid();

  if target_quest_id is null or not public.can_access_quest(target_quest_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;
  return new;
end;
$$;

create trigger enforce_task_event_quest_access_before_insert
before insert on public.task_submission_events
for each row execute function public.enforce_task_event_quest_access();

revoke all on function public.enforce_task_event_quest_access() from public, anon, authenticated;
