-- Add organization-scoped authorization while preserving creator_id compatibility.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  personal_owner_id uuid unique references public.profiles(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, user_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  is_system boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.]*$'),
  description text not null,
  created_at timestamp with time zone not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.membership_roles (
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  primary key (membership_id, role_id)
);

create index organization_memberships_user_id_idx
  on public.organization_memberships (user_id)
  where status = 'active';

create index membership_roles_role_id_idx
  on public.membership_roles (role_id);

insert into public.roles (id, key, name)
values
  ('01000000-0000-4000-8000-000000000001', 'owner', 'Владелец'),
  ('01000000-0000-4000-8000-000000000002', 'admin', 'Администратор'),
  ('01000000-0000-4000-8000-000000000003', 'quest_editor', 'Редактор квестов'),
  ('01000000-0000-4000-8000-000000000004', 'participant_manager', 'Менеджер участников'),
  ('01000000-0000-4000-8000-000000000005', 'sales_manager', 'Менеджер продаж'),
  ('01000000-0000-4000-8000-000000000006', 'host', 'Ведущий')
on conflict (key) do update set name = excluded.name;

insert into public.permissions (key, description)
values
  ('organization.read', 'Просмотр организации'),
  ('organization.manage', 'Изменение настроек организации'),
  ('members.read', 'Просмотр команды организации'),
  ('members.manage', 'Управление командой организации'),
  ('billing.read', 'Просмотр тарифа и биллинга'),
  ('billing.manage', 'Управление тарифом и биллингом'),
  ('quests.read', 'Просмотр квестов организации'),
  ('quests.create', 'Создание квестов'),
  ('quests.update', 'Изменение квестов'),
  ('quests.delete', 'Удаление квестов'),
  ('quests.publish', 'Публикация квестов'),
  ('participants.read', 'Просмотр участников'),
  ('participants.manage', 'Управление участниками'),
  ('quest_runs.conduct', 'Проведение запуска квеста'),
  ('quest_stats.read', 'Просмотр статистики квеста'),
  ('quest_stats.delete', 'Удаление статистики квеста'),
  ('access_grants.manage', 'Управление доступом к квесту')
on conflict (key) do update set description = excluded.description;

with role_matrix(role_key, permission_key) as (
  values
    ('owner', 'organization.read'), ('owner', 'organization.manage'),
    ('owner', 'members.read'), ('owner', 'members.manage'),
    ('owner', 'billing.read'), ('owner', 'billing.manage'),
    ('owner', 'quests.read'), ('owner', 'quests.create'), ('owner', 'quests.update'),
    ('owner', 'quests.delete'), ('owner', 'quests.publish'),
    ('owner', 'participants.read'), ('owner', 'participants.manage'),
    ('owner', 'quest_runs.conduct'), ('owner', 'quest_stats.read'),
    ('owner', 'quest_stats.delete'), ('owner', 'access_grants.manage'),
    ('admin', 'organization.read'), ('admin', 'organization.manage'),
    ('admin', 'members.read'), ('admin', 'members.manage'),
    ('admin', 'quests.read'), ('admin', 'quests.create'), ('admin', 'quests.update'),
    ('admin', 'quests.delete'), ('admin', 'quests.publish'),
    ('admin', 'participants.read'), ('admin', 'participants.manage'),
    ('admin', 'quest_runs.conduct'), ('admin', 'quest_stats.read'),
    ('admin', 'quest_stats.delete'), ('admin', 'access_grants.manage'),
    ('quest_editor', 'organization.read'), ('quest_editor', 'quests.read'),
    ('quest_editor', 'quests.create'), ('quest_editor', 'quests.update'),
    ('quest_editor', 'quests.publish'), ('quest_editor', 'quest_stats.read'),
    ('participant_manager', 'organization.read'), ('participant_manager', 'members.read'),
    ('participant_manager', 'members.manage'), ('participant_manager', 'quests.read'),
    ('participant_manager', 'participants.read'), ('participant_manager', 'participants.manage'),
    ('participant_manager', 'quest_runs.conduct'), ('participant_manager', 'quest_stats.read'),
    ('participant_manager', 'access_grants.manage'),
    ('sales_manager', 'organization.read'), ('sales_manager', 'billing.read'),
    ('sales_manager', 'quests.read'), ('sales_manager', 'participants.read'),
    ('sales_manager', 'participants.manage'), ('sales_manager', 'quest_stats.read'),
    ('sales_manager', 'access_grants.manage'),
    ('host', 'organization.read'), ('host', 'quests.read'),
    ('host', 'participants.read'), ('host', 'quest_runs.conduct'),
    ('host', 'quest_stats.read')
)
insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from role_matrix
join public.roles on roles.key = role_matrix.role_key
join public.permissions on permissions.key = role_matrix.permission_key
on conflict do nothing;

create or replace function public.has_organization_permission(
  target_organization_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.membership_id = membership.id
      join public.role_permissions role_permission
        on role_permission.role_id = membership_role.role_id
      join public.permissions permission
        on permission.id = role_permission.permission_id
      where membership.organization_id = target_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and permission.key = required_permission
    );
$$;

revoke all on function public.has_organization_permission(uuid, text) from public;
grant execute on function public.has_organization_permission(uuid, text) to authenticated;

-- Existing creators each receive one stable personal organization.
insert into public.organizations (name, personal_owner_id)
select
  coalesce(nullif(btrim(profile.username), ''), 'Личная организация'),
  profile.id
from public.profiles profile
where exists (
  select 1 from public.quests quest where quest.creator_id = profile.id
)
on conflict (personal_owner_id) do nothing;

insert into public.organization_memberships (organization_id, user_id, status)
select organization.id, organization.personal_owner_id, 'active'
from public.organizations organization
where organization.personal_owner_id is not null
on conflict (organization_id, user_id) do update set status = 'active';

insert into public.membership_roles (membership_id, role_id)
select membership.id, role.id
from public.organization_memberships membership
join public.organizations organization on organization.id = membership.organization_id
join public.roles role on role.key = 'owner'
where organization.personal_owner_id = membership.user_id
on conflict do nothing;

alter table public.quests add column organization_id uuid;

update public.quests quest
set organization_id = organization.id
from public.organizations organization
where organization.personal_owner_id = quest.creator_id
  and quest.organization_id is null;

alter table public.quests
  alter column organization_id set not null,
  add constraint quests_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete restrict;

create index quests_organization_id_idx on public.quests (organization_id);

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

  select id into provisioned_owner_role_id from public.roles where key = 'owner';

  insert into public.membership_roles (membership_id, role_id)
  values (provisioned_membership_id, provisioned_owner_role_id)
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_profile_created_provision_organization
after insert on public.profiles
for each row execute function public.provision_personal_organization();

create or replace function public.assign_quest_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.organization_id is null then
    select organization.id
    into new.organization_id
    from public.organizations organization
    where organization.personal_owner_id = new.creator_id;
  end if;

  if new.organization_id is null then
    raise exception 'No organization is available for quest creator';
  end if;

  return new;
end;
$$;

create trigger before_quest_insert_assign_organization
before insert on public.quests
for each row execute function public.assign_quest_organization();

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_roles enable row level security;

create policy "Members can read their organizations"
on public.organizations for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = organizations.id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  )
);

create policy "Users can read own memberships"
on public.organization_memberships for select to authenticated
using (user_id = auth.uid());

create policy "Authenticated users can read system roles"
on public.roles for select to authenticated
using (is_system);

create policy "Authenticated users can read permissions"
on public.permissions for select to authenticated
using (true);

create policy "Authenticated users can read role permissions"
on public.role_permissions for select to authenticated
using (true);

create policy "Users can read own membership roles"
on public.membership_roles for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.id = membership_roles.membership_id
      and membership.user_id = auth.uid()
  )
);

grant select on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.roles to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_permissions to authenticated;
grant select on public.membership_roles to authenticated;
