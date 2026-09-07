-- Email binding belongs only to personal invitations, never shared links or codes.

update public.quest_access_credentials
set email = null
where kind <> 'invitation' and email is not null;

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
