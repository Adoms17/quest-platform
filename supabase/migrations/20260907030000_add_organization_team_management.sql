-- Add organization team invitations, role management and security audit events.

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete restrict,
  expires_at timestamp with time zone not null,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (expires_at > created_at),
  check ((status = 'accepted') = (accepted_by is not null and accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index organization_invitations_pending_email_idx
  on public.organization_invitations (organization_id, email)
  where status = 'pending';

create index organization_invitations_organization_created_idx
  on public.organization_invitations (organization_id, created_at desc);

create table public.organization_invitation_roles (
  invitation_id uuid not null references public.organization_invitations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  primary key (invitation_id, role_id)
);

create table public.organization_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in (
    'invitation.created',
    'invitation.accepted',
    'invitation.revoked',
    'membership.roles_changed',
    'membership.revoked'
  )),
  entity_type text not null check (entity_type in ('invitation', 'membership')),
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (not (metadata ?| array['token', 'token_hash', 'email']))
);

create index organization_audit_events_organization_created_idx
  on public.organization_audit_events (organization_id, created_at desc);

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role_keys text[],
  p_expires_at timestamp with time zone default (now() + interval '7 days')
)
returns table (
  invitation_id uuid,
  invitation_token text,
  expires_at timestamp with time zone
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  normalized_email text := lower(btrim(p_email));
  generated_token text := encode(extensions.gen_random_bytes(32), 'hex');
  created_invitation public.organization_invitations%rowtype;
  distinct_role_count integer;
  valid_role_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.has_organization_permission(p_organization_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'organization member management denied';
  end if;

  if normalized_email is null
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using errcode = '22023', message = 'invalid invitation email';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'invitation expiry must be within 30 days';
  end if;

  select count(distinct role_key), count(role.id)
  into distinct_role_count, valid_role_count
  from unnest(coalesce(p_role_keys, array[]::text[])) as requested(role_key)
  left join public.roles role
    on role.key = requested.role_key
   and role.is_system
   and role.key <> 'owner';

  if distinct_role_count = 0 or distinct_role_count <> valid_role_count then
    raise exception using errcode = '22023', message = 'invalid or forbidden invitation roles';
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    join auth.users invited_user on invited_user.id = membership.user_id
    where membership.organization_id = p_organization_id
      and lower(invited_user.email) = normalized_email
      and membership.status = 'active'
  ) then
    raise exception using errcode = '23505', message = 'user is already an active organization member';
  end if;

  update public.organization_invitations
  set status = 'expired', updated_at = now()
  where organization_id = p_organization_id
    and email = normalized_email
    and status = 'pending'
    and organization_invitations.expires_at <= now();

  insert into public.organization_invitations (
    organization_id, email, token_hash, invited_by, expires_at
  ) values (
    p_organization_id,
    normalized_email,
    encode(extensions.digest(convert_to(generated_token, 'UTF8'), 'sha256'), 'hex'),
    auth.uid(),
    p_expires_at
  )
  returning * into created_invitation;

  insert into public.organization_invitation_roles (invitation_id, role_id)
  select created_invitation.id, role.id
  from public.roles role
  where role.key = any(p_role_keys);

  insert into public.organization_audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'invitation.created',
    'invitation',
    created_invitation.id,
    jsonb_build_object('role_keys', to_jsonb(p_role_keys), 'expires_at', p_expires_at)
  );

  return query select created_invitation.id, generated_token, created_invitation.expires_at;
end;
$$;

create or replace function public.accept_organization_invitation(p_token text)
returns table (membership_id uuid, organization_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  matched_invitation public.organization_invitations%rowtype;
  target_membership_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select lower(email) into current_email from auth.users where id = current_user_id;

  select * into matched_invitation
  from public.organization_invitations invitation
  where invitation.token_hash = encode(
    extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'),
    'hex'
  )
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'invalid invitation';
  end if;

  if matched_invitation.status = 'accepted'
     and matched_invitation.accepted_by = current_user_id
  then
    select id into target_membership_id
    from public.organization_memberships
    where organization_memberships.organization_id = matched_invitation.organization_id
      and organization_memberships.user_id = current_user_id;

    return query select target_membership_id, matched_invitation.organization_id;
    return;
  end if;

  if matched_invitation.status <> 'pending' then
    raise exception using errcode = '22023', message = 'invitation is not pending';
  end if;

  if matched_invitation.expires_at <= now() then
    update public.organization_invitations
    set status = 'expired', updated_at = now()
    where id = matched_invitation.id;
    raise exception using errcode = '22023', message = 'invitation has expired';
  end if;

  if current_email is null or current_email <> matched_invitation.email then
    raise exception using errcode = '42501', message = 'invitation belongs to another account';
  end if;

  insert into public.organization_memberships (organization_id, user_id, status)
  values (matched_invitation.organization_id, current_user_id, 'active')
  on conflict on constraint organization_memberships_organization_id_user_id_key do update
    set status = 'active', updated_at = now()
  returning organization_memberships.id into target_membership_id;

  insert into public.membership_roles (membership_id, role_id)
  select target_membership_id, invitation_role.role_id
  from public.organization_invitation_roles invitation_role
  where invitation_role.invitation_id = matched_invitation.id
  on conflict do nothing;

  update public.organization_invitations
  set status = 'accepted',
      accepted_by = current_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = matched_invitation.id;

  insert into public.organization_audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id
  ) values (
    matched_invitation.organization_id,
    current_user_id,
    'invitation.accepted',
    'invitation',
    matched_invitation.id
  );

  return query select target_membership_id, matched_invitation.organization_id;
end;
$$;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_invitation public.organization_invitations%rowtype;
begin
  select * into target_invitation
  from public.organization_invitations
  where id = p_invitation_id
  for update;

  if not found or not public.has_organization_permission(target_invitation.organization_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'organization member management denied';
  end if;

  if target_invitation.status <> 'pending' then
    raise exception using errcode = '22023', message = 'invitation is not pending';
  end if;

  update public.organization_invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = p_invitation_id;

  insert into public.organization_audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id
  ) values (
    target_invitation.organization_id, auth.uid(), 'invitation.revoked', 'invitation', p_invitation_id
  );
end;
$$;

create or replace function public.set_organization_member_roles(
  p_membership_id uuid,
  p_role_keys text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_membership public.organization_memberships%rowtype;
  distinct_role_count integer;
  valid_role_count integer;
begin
  select * into target_membership
  from public.organization_memberships
  where id = p_membership_id
  for update;

  if not found or not public.has_organization_permission(target_membership.organization_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'organization member management denied';
  end if;

  select count(distinct role_key), count(role.id)
  into distinct_role_count, valid_role_count
  from unnest(coalesce(p_role_keys, array[]::text[])) as requested(role_key)
  left join public.roles role
    on role.key = requested.role_key
   and role.is_system
   and role.key <> 'owner';

  if distinct_role_count = 0 or distinct_role_count <> valid_role_count then
    raise exception using errcode = '22023', message = 'invalid or forbidden membership roles';
  end if;

  if exists (
    select 1 from public.membership_roles membership_role
    join public.roles role on role.id = membership_role.role_id
    where membership_role.membership_id = p_membership_id and role.key = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'owner roles require the ownership transfer flow';
  end if;

  delete from public.membership_roles where membership_id = p_membership_id;

  insert into public.membership_roles (membership_id, role_id)
  select p_membership_id, role.id from public.roles role where role.key = any(p_role_keys);

  insert into public.organization_audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    target_membership.organization_id,
    auth.uid(),
    'membership.roles_changed',
    'membership',
    p_membership_id,
    jsonb_build_object('role_keys', to_jsonb(p_role_keys))
  );
end;
$$;

create or replace function public.revoke_organization_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_membership public.organization_memberships%rowtype;
begin
  select * into target_membership
  from public.organization_memberships
  where id = p_membership_id
  for update;

  if not found or not public.has_organization_permission(target_membership.organization_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'organization member management denied';
  end if;

  if exists (
    select 1 from public.membership_roles membership_role
    join public.roles role on role.id = membership_role.role_id
    where membership_role.membership_id = p_membership_id and role.key = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'owner membership requires the ownership transfer flow';
  end if;

  update public.organization_memberships
  set status = 'revoked', updated_at = now()
  where id = p_membership_id;

  insert into public.organization_audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id
  ) values (
    target_membership.organization_id,
    auth.uid(),
    'membership.revoked',
    'membership',
    p_membership_id
  );
end;
$$;

alter table public.organization_invitations enable row level security;
alter table public.organization_invitation_roles enable row level security;
alter table public.organization_audit_events enable row level security;

create policy "Managers can read organization invitations"
on public.organization_invitations for select to authenticated
using (public.has_organization_permission(organization_id, 'members.manage'));

create policy "Managers can read organization invitation roles"
on public.organization_invitation_roles for select to authenticated
using (
  exists (
    select 1 from public.organization_invitations invitation
    where invitation.id = organization_invitation_roles.invitation_id
      and public.has_organization_permission(invitation.organization_id, 'members.manage')
  )
);

create policy "Managers can read organization audit events"
on public.organization_audit_events for select to authenticated
using (public.has_organization_permission(organization_id, 'members.manage'));

drop policy if exists "Users can read own memberships" on public.organization_memberships;
create policy "Members can read manageable organization memberships"
on public.organization_memberships for select to authenticated
using (
  user_id = auth.uid()
  or public.has_organization_permission(organization_id, 'members.read')
);

drop policy if exists "Users can read own membership roles" on public.membership_roles;
create policy "Members can read manageable organization membership roles"
on public.membership_roles for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.id = membership_roles.membership_id
      and (
        membership.user_id = auth.uid()
        or public.has_organization_permission(membership.organization_id, 'members.read')
      )
  )
);

grant select on public.organization_invitations to authenticated;
grant select on public.organization_invitation_roles to authenticated;
grant select on public.organization_audit_events to authenticated;

revoke all on function public.create_organization_invitation(uuid, text, text[], timestamp with time zone) from public;
revoke all on function public.accept_organization_invitation(text) from public;
revoke all on function public.revoke_organization_invitation(uuid) from public;
revoke all on function public.set_organization_member_roles(uuid, text[]) from public;
revoke all on function public.revoke_organization_membership(uuid) from public;

grant execute on function public.create_organization_invitation(uuid, text, text[], timestamp with time zone) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
grant execute on function public.set_organization_member_roles(uuid, text[]) to authenticated;
grant execute on function public.revoke_organization_membership(uuid) to authenticated;
