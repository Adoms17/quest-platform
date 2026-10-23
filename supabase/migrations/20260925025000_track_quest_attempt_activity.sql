begin;
-- Server-owned activity; never writable through an attempt payload.
create table public.quest_attempt_activity (
 quest_attempt_id uuid primary key references public.quest_attempts(id) on delete cascade,
 last_activity_at timestamptz not null,
 is_estimated boolean not null default false
);
alter table public.quest_attempt_activity enable row level security;
revoke all on public.quest_attempt_activity from public,anon,authenticated,service_role;
-- Existing records have incomplete update history. Do not mark them active at deployment.
insert into public.quest_attempt_activity(quest_attempt_id,last_activity_at,is_estimated)
select a.id,coalesce(greatest(a.created_at,a.started_at,a.finished_at,e.last_event,t.last_task),'-infinity'::timestamptz),true
from public.quest_attempts a
left join (select quest_attempt_id,max(created_at) last_event from public.task_submission_events group by quest_attempt_id)e on e.quest_attempt_id=a.id
left join (select quest_attempt_id,max(created_at) last_task from public.task_attempts group by quest_attempt_id)t on t.quest_attempt_id=a.id;
create function public.record_quest_attempt_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare attempt_id uuid;
begin
 if TG_OP='UPDATE' and new is not distinct from old then return new; end if;
 if TG_TABLE_NAME='quest_attempts' then attempt_id:=new.id;
 else attempt_id:=new.quest_attempt_id; end if;
 if TG_TABLE_NAME='task_submission_events' then
  if new.server_state->>'accepted' is distinct from 'true' then return new; end if;
 end if;
 insert into public.quest_attempt_activity(quest_attempt_id,last_activity_at,is_estimated)
 values(attempt_id,statement_timestamp(),false)
 on conflict(quest_attempt_id) do update set last_activity_at=greatest(quest_attempt_activity.last_activity_at,excluded.last_activity_at),is_estimated=false;
 return new;
end; $$;
revoke all on function public.record_quest_attempt_activity() from public,anon,authenticated,service_role;
create trigger record_quest_attempt_activity after insert or update on public.quest_attempts for each row execute function public.record_quest_attempt_activity();
create trigger record_task_attempt_activity after insert or update on public.task_attempts for each row execute function public.record_quest_attempt_activity();
create trigger record_submission_activity after insert on public.task_submission_events for each row execute function public.record_quest_attempt_activity();
commit;
