-- Redeem quest credentials for an explicitly selected accessible participant profile.

create or replace function public.redeem_quest_access_credential_for_participant(
  p_token text,
  p_participant_profile_id uuid
)
returns table (grant_id uuid, quest_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  credential public.quest_access_credentials%rowtype;
  existing_grant public.quest_access_grants%rowtype;
  created_grant public.quest_access_grants%rowtype;
  organization_id uuid;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'participant profile access denied';
  end if;
  if p_token is null or length(p_token) < 32 then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  select * into credential from public.quest_access_credentials candidate
  where candidate.kind in ('link', 'invitation')
    and candidate.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found or credential.status <> 'active'
    or (credential.expires_at is not null and credential.expires_at <= now()) then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  update public.quest_access_grants access_grant set status = 'expired'
  where access_grant.quest_id = credential.quest_id
    and access_grant.participant_profile_id = p_participant_profile_id
    and access_grant.status = 'active' and access_grant.expires_at <= now();
  select * into existing_grant from public.quest_access_grants access_grant
  where access_grant.quest_id = credential.quest_id
    and access_grant.participant_profile_id = p_participant_profile_id
    and access_grant.status = 'active'
    and (access_grant.expires_at is null or access_grant.expires_at > now());
  if found then return query select existing_grant.id, existing_grant.quest_id; return; end if;

  if credential.email is not null then
    select lower(email) into current_email from auth.users where id = current_user_id;
    if current_email is distinct from credential.email then
      raise exception using errcode = '42501', message = 'quest access credential belongs to another account';
    end if;
  end if;
  if credential.max_redemptions is not null and credential.redemption_count >= credential.max_redemptions then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  insert into public.quest_access_grants (quest_id, user_id, participant_profile_id, credential_id, expires_at)
  values (credential.quest_id, current_user_id, p_participant_profile_id, credential.id, credential.expires_at)
  returning * into created_grant;
  update public.quest_access_credentials set redemption_count = redemption_count + 1 where id = credential.id;
  select quest.organization_id into organization_id from public.quests quest where quest.id = credential.quest_id;
  insert into public.organization_audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (organization_id, current_user_id, 'quest_access.credential_redeemed',
    'quest_access_grant', created_grant.id,
    jsonb_build_object('quest_id', credential.quest_id, 'credential_id', credential.id));
  return query select created_grant.id, created_grant.quest_id;
end;
$$;

create or replace function public.redeem_quest_access_code_for_participant(
  p_code text,
  p_participant_profile_id uuid
)
returns table (
  success boolean, error_code text, retry_after_seconds integer,
  grant_id uuid, quest_id uuid
)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
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
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'participant profile access denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(current_user_id::text));
  delete from public.quest_access_code_attempts attempt
  where attempt.user_id = current_user_id and attempt.attempted_at <= now() - interval '1 day';
  select count(*), min(attempt.attempted_at) into failed_attempts, oldest_failed_at
  from public.quest_access_code_attempts attempt
  where attempt.user_id = current_user_id and not attempt.succeeded
    and attempt.attempted_at > now() - interval '10 minutes';
  if failed_attempts >= 5 then
    return query select false, 'rate_limited'::text,
      greatest(1, ceil(extract(epoch from oldest_failed_at + interval '10 minutes' - now()))::integer),
      null::uuid, null::uuid;
    return;
  end if;

  if length(normalized_code) = 12 then
    select * into credential from public.quest_access_credentials candidate
    where candidate.kind = 'code'
      and candidate.token_hash = encode(extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'), 'hex')
    for update;
    credential_found := found;
  end if;
  if not credential_found or credential.status <> 'active'
    or (credential.expires_at is not null and credential.expires_at <= now()) then
    insert into public.quest_access_code_attempts (user_id, succeeded) values (current_user_id, false);
    return query select false, 'invalid'::text, null::integer, null::uuid, null::uuid; return;
  end if;

  update public.quest_access_grants access_grant set status = 'expired'
  where access_grant.quest_id = credential.quest_id
    and access_grant.participant_profile_id = p_participant_profile_id
    and access_grant.status = 'active' and access_grant.expires_at <= now();
  select * into existing_grant from public.quest_access_grants access_grant
  where access_grant.quest_id = credential.quest_id
    and access_grant.participant_profile_id = p_participant_profile_id
    and access_grant.status = 'active'
    and (access_grant.expires_at is null or access_grant.expires_at > now());
  if found then
    return query select true, null::text, null::integer, existing_grant.id, existing_grant.quest_id; return;
  end if;
  if credential.max_redemptions is not null and credential.redemption_count >= credential.max_redemptions then
    insert into public.quest_access_code_attempts (user_id, succeeded) values (current_user_id, false);
    return query select false, 'invalid'::text, null::integer, null::uuid, null::uuid; return;
  end if;

  insert into public.quest_access_grants (quest_id, user_id, participant_profile_id, credential_id, expires_at)
  values (credential.quest_id, current_user_id, p_participant_profile_id, credential.id, credential.expires_at)
  returning * into created_grant;
  update public.quest_access_credentials set redemption_count = redemption_count + 1 where id = credential.id;
  insert into public.quest_access_code_attempts (user_id, succeeded) values (current_user_id, true);
  select quest.organization_id into organization_id from public.quests quest where quest.id = credential.quest_id;
  insert into public.organization_audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (organization_id, current_user_id, 'quest_access.credential_redeemed',
    'quest_access_grant', created_grant.id,
    jsonb_build_object('quest_id', credential.quest_id, 'credential_id', credential.id));
  return query select true, null::text, null::integer, created_grant.id, created_grant.quest_id;
end;
$$;

revoke all on function public.redeem_quest_access_credential_for_participant(text, uuid) from public;
revoke all on function public.redeem_quest_access_code_for_participant(text, uuid) from public;
grant execute on function public.redeem_quest_access_credential_for_participant(text, uuid) to authenticated;
grant execute on function public.redeem_quest_access_code_for_participant(text, uuid) to authenticated;
