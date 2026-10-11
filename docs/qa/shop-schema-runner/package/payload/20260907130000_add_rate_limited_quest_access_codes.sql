-- Add short quest access codes with account-scoped server-side brute-force protection.

create table if not exists public.quest_access_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamp with time zone not null default now(),
  succeeded boolean not null default false
);

create index if not exists quest_access_code_attempts_user_time_idx
  on public.quest_access_code_attempts (user_id, attempted_at desc);

alter table public.quest_access_code_attempts enable row level security;
revoke all on table public.quest_access_code_attempts from anon, authenticated;

create or replace function public.create_quest_access_credential(
  p_quest_id uuid, p_kind text, p_email text default null,
  p_max_redemptions integer default 1,
  p_expires_at timestamp with time zone default (now() + interval '7 days')
)
returns table (credential_id uuid, credential_token text, expires_at timestamp with time zone)
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare
  normalized_token text;
  displayed_token text;
  normalized_email text := nullif(lower(btrim(p_email)), '');
  effective_max_redemptions integer := p_max_redemptions;
  created public.quest_access_credentials%rowtype;
  organization_id uuid;
begin
  if auth.uid() is null or not public.has_quest_permission(p_quest_id, 'access_grants.manage') then
    raise exception using errcode = '42501', message = 'quest access management denied';
  end if;
  if p_kind not in ('invitation', 'code', 'link') then
    raise exception using errcode = '22023', message = 'invalid credential kind';
  end if;
  if p_kind = 'invitation' and normalized_email is null then
    raise exception using errcode = '22023', message = 'invitation email required';
  end if;
  if p_kind <> 'invitation' then normalized_email := null; end if;
  if p_kind = 'invitation' then effective_max_redemptions := 1; end if;
  if effective_max_redemptions is not null and effective_max_redemptions < 1 then
    raise exception using errcode = '22023', message = 'invalid redemption limit';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '90 days') then
    raise exception using errcode = '22023', message = 'invalid credential expiry';
  end if;

  if p_kind = 'code' then
    normalized_token := upper(encode(extensions.gen_random_bytes(6), 'hex'));
    displayed_token := substr(normalized_token, 1, 6) || '-' || substr(normalized_token, 7, 6);
  else
    normalized_token := encode(extensions.gen_random_bytes(32), 'hex');
    displayed_token := normalized_token;
  end if;

  insert into public.quest_access_credentials
    (quest_id, kind, token_hash, email, max_redemptions, expires_at, created_by)
  values (p_quest_id, p_kind, encode(extensions.digest(normalized_token, 'sha256'), 'hex'),
    normalized_email, effective_max_redemptions, p_expires_at, auth.uid())
  returning * into created;
  select q.organization_id into organization_id from public.quests q where q.id = p_quest_id;
  insert into public.organization_audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (organization_id, auth.uid(), 'quest_access.credential_created',
    'quest_access_credential', created.id,
    jsonb_build_object('quest_id', p_quest_id, 'kind', p_kind,
      'max_redemptions', effective_max_redemptions));
  return query select created.id, displayed_token, created.expires_at;
end;
$$;

create or replace function public.redeem_quest_access_code(p_code text)
returns table (
  success boolean, error_code text, retry_after_seconds integer,
  grant_id uuid, quest_id uuid
)
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9a-fA-F]', '', 'g'));
  credential public.quest_access_credentials%rowtype;
  existing_grant public.quest_access_grants%rowtype;
  created_grant public.quest_access_grants%rowtype;
  organization_id uuid;
  failed_attempts integer;
  oldest_failed_at timestamp with time zone;
  credential_found boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(current_user_id::text));
  delete from public.quest_access_code_attempts a
  where a.user_id = current_user_id and a.attempted_at <= now() - interval '1 day';
  select count(*), min(a.attempted_at)
    into failed_attempts, oldest_failed_at
  from public.quest_access_code_attempts a
  where a.user_id = current_user_id and not a.succeeded
    and a.attempted_at > now() - interval '10 minutes';

  if failed_attempts >= 5 then
    return query select false, 'rate_limited'::text,
      greatest(1, ceil(extract(epoch from oldest_failed_at + interval '10 minutes' - now()))::integer),
      null::uuid, null::uuid;
    return;
  end if;

  if length(normalized_code) = 12 then
    select * into credential from public.quest_access_credentials c
    where c.kind = 'code'
      and c.token_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
    for update;
    credential_found := found;
  end if;

  if not credential_found or credential.status <> 'active'
    or (credential.expires_at is not null and credential.expires_at <= now()) then
    insert into public.quest_access_code_attempts (user_id, succeeded)
    values (current_user_id, false);
    return query select false, 'invalid'::text, null::integer, null::uuid, null::uuid;
    return;
  end if;

  update public.quest_access_grants g set status = 'expired'
  where g.quest_id = credential.quest_id and g.user_id = current_user_id
    and g.status = 'active' and g.expires_at is not null and g.expires_at <= now();
  select * into existing_grant from public.quest_access_grants g
  where g.quest_id = credential.quest_id and g.user_id = current_user_id
    and g.status = 'active' and (g.expires_at is null or g.expires_at > now());
  if found then
    return query select true, null::text, null::integer, existing_grant.id, existing_grant.quest_id;
    return;
  end if;

  if credential.max_redemptions is not null and credential.redemption_count >= credential.max_redemptions then
    insert into public.quest_access_code_attempts (user_id, succeeded)
    values (current_user_id, false);
    return query select false, 'invalid'::text, null::integer, null::uuid, null::uuid;
    return;
  end if;

  insert into public.quest_access_grants (quest_id, user_id, credential_id, expires_at)
  values (credential.quest_id, current_user_id, credential.id, credential.expires_at)
  returning * into created_grant;
  update public.quest_access_credentials set redemption_count = redemption_count + 1 where id = credential.id;
  select q.organization_id into organization_id from public.quests q where q.id = credential.quest_id;
  insert into public.organization_audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (organization_id, current_user_id, 'quest_access.credential_redeemed',
    'quest_access_grant', created_grant.id,
    jsonb_build_object('quest_id', credential.quest_id, 'credential_id', credential.id));
  return query select true, null::text, null::integer, created_grant.id, created_grant.quest_id;
end;
$$;

revoke all on function public.redeem_quest_access_code(text) from public;
grant execute on function public.redeem_quest_access_code(text) to authenticated;
