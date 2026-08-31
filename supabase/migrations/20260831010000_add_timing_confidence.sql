-- Keep server-observed time separate from client-reported offline time.
-- Legacy time_spent/total_time remain server-authoritative for compatibility.

alter table public.task_attempts
  add column trusted_time_seconds integer not null default 0,
  add column reported_offline_time_seconds integer not null default 0,
  add column timing_confidence text not null default 'trusted';

alter table public.task_attempts
  add constraint task_attempts_trusted_time_nonnegative
    check (trusted_time_seconds >= 0),
  add constraint task_attempts_reported_time_valid
    check (
      reported_offline_time_seconds >= 0
      and reported_offline_time_seconds <= 86400
    ),
  add constraint task_attempts_timing_confidence_valid
    check (timing_confidence in ('trusted', 'bounded', 'reported'));

alter table public.quest_attempts
  add column trusted_time_seconds integer not null default 0,
  add column reported_offline_time_seconds integer not null default 0,
  add column timing_confidence text not null default 'trusted';

alter table public.quest_attempts
  add constraint quest_attempts_trusted_time_nonnegative
    check (trusted_time_seconds >= 0),
  add constraint quest_attempts_reported_time_nonnegative
    check (reported_offline_time_seconds >= 0),
  add constraint quest_attempts_timing_confidence_valid
    check (timing_confidence in ('trusted', 'bounded', 'reported'));

update public.task_attempts
set trusted_time_seconds = coalesce(time_spent, 0);

update public.quest_attempts
set trusted_time_seconds = coalesce(total_time, 0);

create or replace function public.apply_submission_timing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_started_at timestamptz;
  server_elapsed_seconds integer;
  event_confidence text;
  trusted_total integer;
  reported_total integer;
  aggregate_confidence text;
begin
  if new.event_type <> 'answer' then
    return new;
  end if;

  select qa.started_at
  into attempt_started_at
  from public.quest_attempts qa
  where qa.id = new.quest_attempt_id;

  if attempt_started_at is null then
    raise exception using
      errcode = '23503',
      message = 'quest attempt not found for timing event';
  end if;

  if new.client_elapsed_seconds is not null
     and new.client_elapsed_seconds > 86400 then
    raise exception using
      errcode = '22023',
      message = 'reported offline time exceeds 24 hour limit';
  end if;

  if new.client_elapsed_seconds is null then
    update public.task_attempts ta
    set trusted_time_seconds = greatest(
      ta.trusted_time_seconds,
      coalesce(ta.time_spent, 0)
    )
    where ta.quest_attempt_id = new.quest_attempt_id
      and ta.task_id = new.task_id;
  else
    server_elapsed_seconds := greatest(
      0,
      floor(extract(epoch from (now() - attempt_started_at)))::integer
    );

    event_confidence := case
      when new.client_elapsed_seconds <= server_elapsed_seconds then 'bounded'
      else 'reported'
    end;

    update public.task_attempts ta
    set
      reported_offline_time_seconds = greatest(
        ta.reported_offline_time_seconds,
        new.client_elapsed_seconds
      ),
      timing_confidence = case
        when ta.timing_confidence = 'reported'
          or event_confidence = 'reported' then 'reported'
        else 'bounded'
      end
    where ta.quest_attempt_id = new.quest_attempt_id
      and ta.task_id = new.task_id;
  end if;

  select
    coalesce(sum(ta.trusted_time_seconds), 0)::integer,
    coalesce(sum(ta.reported_offline_time_seconds), 0)::integer,
    case
      when count(*) filter (where ta.timing_confidence = 'reported') > 0
        then 'reported'
      when count(*) filter (where ta.timing_confidence = 'bounded') > 0
        then 'bounded'
      else 'trusted'
    end
  into trusted_total, reported_total, aggregate_confidence
  from public.task_attempts ta
  where ta.quest_attempt_id = new.quest_attempt_id;

  update public.quest_attempts qa
  set
    trusted_time_seconds = trusted_total,
    reported_offline_time_seconds = reported_total,
    timing_confidence = aggregate_confidence
  where qa.id = new.quest_attempt_id;

  return new;
end;
$$;

revoke all on function public.apply_submission_timing() from public;
revoke all on function public.apply_submission_timing() from anon;
revoke all on function public.apply_submission_timing() from authenticated;

create trigger apply_submission_timing_after_insert
after insert on public.task_submission_events
for each row
execute function public.apply_submission_timing();
