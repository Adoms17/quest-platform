-- Expose a bounded, permission-checked audit feed without leaking sensitive metadata.

create or replace function public.get_organization_audit_feed(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id bigint,
  actor_user_id uuid,
  actor_username text,
  action text,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.has_organization_permission(p_organization_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'organization audit access denied';
  end if;

  return query
  select
    event.id,
    event.actor_user_id,
    profile.username as actor_username,
    event.action,
    event.entity_type,
    event.entity_id,
    event.metadata - array['token', 'token_hash', 'email'],
    event.created_at
  from public.organization_audit_events event
  left join public.profiles profile on profile.id = event.actor_user_id
  where event.organization_id = p_organization_id
  order by event.created_at desc, event.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.get_organization_audit_feed(uuid, integer) from public;
grant execute on function public.get_organization_audit_feed(uuid, integer) to authenticated;
