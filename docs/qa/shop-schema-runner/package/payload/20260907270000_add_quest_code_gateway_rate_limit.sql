-- Add a service-only gateway guard without storing raw IP or device identifiers.

create table public.quest_access_gateway_attempts (
  id bigint generated always as identity primary key,
  key_type text not null check (key_type in ('network', 'device')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamp with time zone not null default now(),
  succeeded boolean not null default false
);

create index quest_access_gateway_attempts_key_time_idx
  on public.quest_access_gateway_attempts (key_type, key_hash, attempted_at desc);

alter table public.quest_access_gateway_attempts enable row level security;
revoke all on table public.quest_access_gateway_attempts from public, anon, authenticated;

create function public.redeem_quest_access_code_from_gateway(
  p_actor_user_id uuid,
  p_code text,
  p_participant_profile_id uuid,
  p_network_hash text,
  p_device_hash text default null
)
returns table (
  success boolean, error_code text, retry_after_seconds integer,
  grant_id uuid, quest_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rate_count integer;
  oldest_attempt timestamp with time zone;
  redemption record;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'gateway access denied';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_user_id) then
    raise exception using errcode = '42501', message = 'gateway actor not found';
  end if;
  if p_network_hash is null or p_network_hash !~ '^[0-9a-f]{64}$'
    or (p_device_hash is not null and p_device_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'invalid gateway fingerprint';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_network_hash));
  if p_device_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_device_hash));
  end if;
  delete from public.quest_access_gateway_attempts attempt
  where attempt.attempted_at <= now() - interval '1 day';

  select count(*), min(attempt.attempted_at)
  into rate_count, oldest_attempt
  from public.quest_access_gateway_attempts attempt
  where not attempt.succeeded
    and attempt.attempted_at > now() - interval '10 minutes'
    and (
      (attempt.key_type = 'network' and attempt.key_hash = p_network_hash)
      or (p_device_hash is not null and attempt.key_type = 'device' and attempt.key_hash = p_device_hash)
    );
  if rate_count >= 20 then
    return query select false, 'rate_limited'::text,
      greatest(1, ceil(extract(epoch from oldest_attempt + interval '10 minutes' - now()))::integer),
      null::uuid, null::uuid;
    return;
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  if p_participant_profile_id is null then
    select * into redemption from public.redeem_quest_access_code(p_code);
  else
    select * into redemption from public.redeem_quest_access_code_for_participant(
      p_code, p_participant_profile_id
    );
  end if;

  if redemption.error_code = 'invalid' then
    insert into public.quest_access_gateway_attempts (key_type, key_hash, succeeded)
    values ('network', p_network_hash, false);
    if p_device_hash is not null then
      insert into public.quest_access_gateway_attempts (key_type, key_hash, succeeded)
      values ('device', p_device_hash, false);
    end if;
  end if;

  return query select redemption.success, redemption.error_code,
    redemption.retry_after_seconds, redemption.grant_id, redemption.quest_id;
end;
$$;

revoke all on function public.redeem_quest_access_code_from_gateway(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.redeem_quest_access_code_from_gateway(uuid, text, uuid, text, text)
  to service_role;
