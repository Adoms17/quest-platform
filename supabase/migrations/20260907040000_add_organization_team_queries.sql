-- Expose the minimum team profile data through a permission-checked RPC.

create or replace function public.get_organization_team(p_organization_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  username text,
  status text,
  joined_at timestamp with time zone,
  roles jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.has_organization_permission(p_organization_id, 'members.read') then
    raise exception using errcode = '42501', message = 'organization team access denied';
  end if;

  return query
  select
    membership.id,
    membership.user_id,
    account.email::text,
    profile.username,
    membership.status,
    membership.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object('key', role.key, 'name', role.name)
        order by role.name
      ) filter (where role.id is not null),
      '[]'::jsonb
    )
  from public.organization_memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join auth.users account on account.id = membership.user_id
  left join public.membership_roles membership_role
    on membership_role.membership_id = membership.id
  left join public.roles role on role.id = membership_role.role_id
  where membership.organization_id = p_organization_id
  group by membership.id, account.email, profile.username
  order by
    case membership.status when 'active' then 0 else 1 end,
    lower(coalesce(profile.username, account.email));
end;
$$;

revoke all on function public.get_organization_team(uuid) from public;
grant execute on function public.get_organization_team(uuid) to authenticated;

