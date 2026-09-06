-- Correct PL/pgSQL variable names that could collide with column names.
-- Kept as a separate migration so already-running local environments can be
-- repaired without resetting and losing local test data.

create or replace function public.provision_personal_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  provisioned_organization_id uuid;
  provisioned_membership_id uuid;
  provisioned_owner_role_id uuid;
begin
  insert into public.organizations (name, personal_owner_id)
  values (coalesce(nullif(btrim(new.username), ''), 'Личная организация'), new.id)
  on conflict (personal_owner_id) do update
    set personal_owner_id = excluded.personal_owner_id
  returning id into provisioned_organization_id;

  insert into public.organization_memberships (organization_id, user_id, status)
  values (provisioned_organization_id, new.id, 'active')
  on conflict (organization_id, user_id) do update set status = 'active'
  returning id into provisioned_membership_id;

  select id
  into provisioned_owner_role_id
  from public.roles
  where key = 'owner';

  insert into public.membership_roles (membership_id, role_id)
  values (provisioned_membership_id, provisioned_owner_role_id)
  on conflict do nothing;

  return new;
end;
$$;

