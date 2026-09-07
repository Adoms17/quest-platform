-- A token holder can preview non-secret quest context before redemption.

create or replace function public.get_quest_access_preview(p_token text)
returns table (
  quest_id uuid,
  quest_title text,
  quest_description text,
  organization_name text,
  task_count integer,
  is_open boolean,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  verification_options jsonb,
  credential_kind text,
  credential_expires_at timestamp with time zone
)
language plpgsql stable security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_token is null or length(p_token) < 32 then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;
  select lower(account.email) into current_email
  from auth.users account where account.id = current_user_id;

  return query
  select quest.id, quest.title, quest.description, organization.name,
    (select count(*)::integer from public.tasks task where task.quest_id = quest.id),
    quest.is_open, quest.start_at, quest.end_at, quest.verification_options,
    credential.kind, credential.expires_at
  from public.quest_access_credentials credential
  join public.quests quest on quest.id = credential.quest_id
  join public.organizations organization on organization.id = quest.organization_id
  where credential.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and credential.status = 'active'
    and (credential.expires_at is null or credential.expires_at > now())
    and (credential.email is null or credential.email = current_email)
    and (
      credential.max_redemptions is null
      or credential.redemption_count < credential.max_redemptions
      or exists (
        select 1 from public.quest_access_grants access_grant
        where access_grant.quest_id = credential.quest_id
          and access_grant.user_id = current_user_id
          and access_grant.status = 'active'
          and (access_grant.expires_at is null or access_grant.expires_at > now())
      )
    );
end;
$$;

revoke all on function public.get_quest_access_preview(text) from public, anon;
grant execute on function public.get_quest_access_preview(text) to authenticated;
