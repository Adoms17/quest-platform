alter table public.task_submission_events drop constraint task_submission_events_event_type_check;
alter table public.task_submission_events add constraint task_submission_events_event_type_check check (event_type in ('open', 'answer', 'finish'));

create or replace function public.finish_quest_early(p_quest_attempt_id uuid, p_task_id uuid, p_client_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt public.quest_attempts%rowtype;
  receipt public.task_submission_events%rowtype;
  result jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_client_event_id is null then raise exception using errcode = '22023', message = 'client_event_id required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_event_id::text, 0));
  select * into attempt from public.quest_attempts where id = p_quest_attempt_id and user_id = auth.uid() for update;
  if not found then raise exception using errcode = '42501', message = 'quest attempt access denied'; end if;
  select * into receipt from public.task_submission_events where client_event_id = p_client_event_id;
  if found then
    if receipt.quest_attempt_id <> p_quest_attempt_id or receipt.task_id <> p_task_id or receipt.event_type <> 'finish' then
      raise exception using errcode = '23505', message = 'client_event_id already used';
    end if;
    return receipt.server_state;
  end if;
  if not exists (select 1 from public.tasks where id = p_task_id and quest_id = attempt.quest_id) then
    raise exception using errcode = '23514', message = 'task attempt quest mismatch';
  end if;
  update public.quest_attempts set finished_at = coalesce(finished_at, now()) where id = attempt.id returning * into attempt;
  result := jsonb_build_object('accepted', true, 'quest_attempt', to_jsonb(attempt));
  insert into public.task_submission_events(client_event_id, quest_attempt_id, task_id, event_type, server_state)
    values(p_client_event_id, attempt.id, p_task_id, 'finish', result);
  return result;
end;
$$;
revoke all on function public.finish_quest_early(uuid, uuid, uuid) from public, anon;
grant execute on function public.finish_quest_early(uuid, uuid, uuid) to authenticated;
