-- Expose participant identity for access managers without weakening profile RLS.

create or replace function public.get_quest_access_grants(p_quest_id uuid)
returns table (
  grant_id uuid,
  user_id uuid,
  email text,
  username text,
  status text,
  granted_at timestamp with time zone,
  expires_at timestamp with time zone,
  credential_kind text
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_quest_permission(p_quest_id, 'access_grants.manage') then
    raise exception using errcode = '42501', message = 'quest access management denied';
  end if;

  return query
  select access_grant.id, access_grant.user_id, account.email::text, profile.username,
    access_grant.status, access_grant.granted_at, access_grant.expires_at, credential.kind
  from public.quest_access_grants access_grant
  join public.profiles profile on profile.id = access_grant.user_id
  join auth.users account on account.id = access_grant.user_id
  left join public.quest_access_credentials credential on credential.id = access_grant.credential_id
  where access_grant.quest_id = p_quest_id
  order by access_grant.granted_at desc, access_grant.id;
end;
$$;

revoke all on function public.get_quest_access_grants(uuid) from public;
grant execute on function public.get_quest_access_grants(uuid) to authenticated;
