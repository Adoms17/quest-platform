-- One observation per account, no event history and no historical backfill.
begin;

create table public.account_activity (
  account_id uuid primary key references auth.users(id) on delete cascade,
  last_activity_at timestamptz not null
);
alter table public.account_activity enable row level security;
revoke all on public.account_activity from public, anon, authenticated;
grant select on public.account_activity to authenticated;
create policy account_activity_read_own on public.account_activity
  for select to authenticated using (account_id = (select auth.uid()));

create function public.record_my_account_activity()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  observed_at timestamptz := now();
  stored_at timestamptz;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- ON CONFLICT serializes concurrent calls; repeats within 24 hours do not write.
  insert into public.account_activity as activity (account_id, last_activity_at)
  values (actor, observed_at)
  on conflict (account_id) do update set last_activity_at = excluded.last_activity_at
  where activity.last_activity_at <= excluded.last_activity_at - interval '24 hours'
  returning last_activity_at into stored_at;

  if stored_at is null then
    select last_activity_at into stored_at from public.account_activity where account_id = actor;
  end if;
  -- Relative server delay avoids using the client wall clock as the authority.
  return greatest(1, least(86400, ceil(extract(epoch from
    (stored_at + interval '24 hours' - observed_at)))::integer));
end;
$function$;
revoke all on function public.record_my_account_activity() from public, anon, authenticated;
grant execute on function public.record_my_account_activity() to authenticated;

comment on column public.account_activity.last_activity_at is
  'Server observation of foreground account use, coalesced over 24 hours; absent row means unknown, not inactive. Not sufficient alone for deletion.';
commit;
