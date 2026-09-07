-- Complete lifecycle handling and auditing for quest participant access.

alter table public.organization_audit_events
  drop constraint if exists organization_audit_events_action_check;
alter table public.organization_audit_events
  add constraint organization_audit_events_action_check check (action in (
    'invitation.created', 'invitation.accepted', 'invitation.revoked',
    'membership.roles_changed', 'membership.revoked',
    'quest_access.credential_created', 'quest_access.credential_redeemed',
    'quest_access.credential_revoked', 'quest_access.grant_revoked'
  ));
alter table public.organization_audit_events
  drop constraint if exists organization_audit_events_entity_type_check;
alter table public.organization_audit_events
  add constraint organization_audit_events_entity_type_check
  check (entity_type in ('invitation', 'membership', 'quest_access_credential', 'quest_access_grant'));

create or replace function public.create_quest_access_credential(
  p_quest_id uuid, p_kind text, p_email text default null,
  p_max_redemptions integer default 1,
  p_expires_at timestamp with time zone default (now() + interval '7 days')
)
returns table (credential_id uuid, credential_token text, expires_at timestamp with time zone)
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare
  generated_token text := encode(extensions.gen_random_bytes(32), 'hex');
  normalized_email text := nullif(lower(btrim(p_email)), '');
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
  if p_max_redemptions is not null and p_max_redemptions < 1 then
    raise exception using errcode = '22023', message = 'invalid redemption limit';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '90 days') then
    raise exception using errcode = '22023', message = 'invalid credential expiry';
  end if;

  insert into public.quest_access_credentials
    (quest_id, kind, token_hash, email, max_redemptions, expires_at, created_by)
  values (p_quest_id, p_kind, encode(extensions.digest(generated_token, 'sha256'), 'hex'),
    normalized_email, p_max_redemptions, p_expires_at, auth.uid())
  returning * into created;
  select q.organization_id into organization_id from public.quests q where q.id = p_quest_id;
  insert into public.organization_audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id,
     metadata)
  values (organization_id, auth.uid(), 'quest_access.credential_created',
    'quest_access_credential', created.id,
    jsonb_build_object('quest_id', p_quest_id, 'kind', p_kind,
      'max_redemptions', p_max_redemptions));
  return query select created.id, generated_token, created.expires_at;
end;
$$;

create or replace function public.redeem_quest_access_credential(p_token text)
returns table (grant_id uuid, quest_id uuid)
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid(); current_email text;
  credential public.quest_access_credentials%rowtype;
  existing_grant public.quest_access_grants%rowtype;
  created_grant public.quest_access_grants%rowtype;
  organization_id uuid;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_token is null or length(p_token) < 32 then raise exception using errcode = '22023', message = 'invalid quest access credential'; end if;
  select * into credential from public.quest_access_credentials c
  where c.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found or credential.status <> 'active' or
    (credential.expires_at is not null and credential.expires_at <= now()) then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  update public.quest_access_grants g set status = 'expired'
  where g.quest_id = credential.quest_id and g.user_id = current_user_id
    and g.status = 'active' and g.expires_at is not null and g.expires_at <= now();
  select * into existing_grant from public.quest_access_grants g
  where g.quest_id = credential.quest_id and g.user_id = current_user_id
    and g.status = 'active' and (g.expires_at is null or g.expires_at > now());
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
  return query select created_grant.id, created_grant.quest_id;
end;
$$;

create or replace function public.revoke_quest_access_grant(p_grant_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare target public.quest_access_grants%rowtype; organization_id uuid;
begin
  select * into target from public.quest_access_grants where id = p_grant_id for update;
  if not found or not public.has_quest_permission(target.quest_id, 'access_grants.manage') then
    raise exception using errcode = '42501', message = 'quest access management denied';
  end if;
  update public.quest_access_grants set status = 'revoked', revoked_at = now()
  where id = p_grant_id and status = 'active';
  if found then
    select q.organization_id into organization_id from public.quests q where q.id = target.quest_id;
    insert into public.organization_audit_events
      (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (organization_id, auth.uid(), 'quest_access.grant_revoked',
      'quest_access_grant', target.id, jsonb_build_object('quest_id', target.quest_id));
  end if;
end;
$$;

revoke all on function public.revoke_quest_access_grant(uuid) from public;
grant execute on function public.revoke_quest_access_grant(uuid) to authenticated;
