begin;

-- Системные роли не связаны с membership или тарифом организации.
create table public.platform_roles (
  key text primary key,
  name text not null
);
insert into public.platform_roles values
 ('owner','Владелец сервиса'), ('operations','Операционный менеджер'),
 ('support','Техническая поддержка'), ('sales','Менеджер продаж'),
 ('regional','Региональный менеджер');

-- На первом срезе включено только чтение минимальной карточки.
create table public.platform_role_permissions (
  role_key text references public.platform_roles(key) on delete restrict,
  permission_key text not null check (permission_key = 'organization.summary.read'),
  primary key(role_key, permission_key)
);
insert into public.platform_role_permissions
 select key,'organization.summary.read' from public.platform_roles where key <> 'regional';

create table public.platform_access_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  role_key text not null references public.platform_roles(key) on delete restrict,
  scope_kind text not null check(scope_kind in ('platform','organization','support_case')),
  organization_id uuid references public.organizations(id) on delete restrict,
  -- Непубличный идентификатор обращения; без текста и персональных данных.
  support_case_id uuid,
  valid_from timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at is null or expires_at > valid_from),
  check((scope_kind='platform' and organization_id is null and support_case_id is null)
    or (scope_kind='organization' and organization_id is not null and support_case_id is null)
    or (scope_kind='support_case' and organization_id is not null and support_case_id is not null and expires_at is not null)),
  check((role_key='owner' and scope_kind='platform' and expires_at is null)
    or (role_key in ('operations','sales') and scope_kind in ('platform','organization'))
    or (role_key='support' and scope_kind='support_case'))
);
create index platform_access_user_idx on public.platform_access_assignments(user_id) where revoked_at is null;

create table public.platform_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete restrict,
  assignment_id uuid references public.platform_access_assignments(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  action text not null check(action in ('assignment.created','assignment.updated','organization.summary.read')),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.platform_roles enable row level security;
alter table public.platform_role_permissions enable row level security;
alter table public.platform_access_assignments enable row level security;
alter table public.platform_audit_events enable row level security;
revoke all on public.platform_roles, public.platform_role_permissions,
 public.platform_access_assignments, public.platform_audit_events from public,anon,authenticated,service_role;
revoke all on sequence public.platform_audit_events_id_seq from public,anon,authenticated,service_role;

-- Прямое назначение возможно только доверенной SQL-процедурой оператора БД.
-- Даже bootstrap фиксируется, без автоматического назначения создателям организаций.
create function public.audit_platform_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action)
 values(auth.uid(),new.id,new.organization_id,case when tg_op='INSERT' then 'assignment.created' else 'assignment.updated' end);
 return new;
end; $$;
revoke all on function public.audit_platform_assignment() from public,anon,authenticated,service_role;
create trigger platform_assignment_audit after insert or update on public.platform_access_assignments
 for each row execute function public.audit_platform_assignment();

-- Не принимает actor_id от клиента. Permission и область проверяются одним назначением.
create function public.require_platform_permission(p_permission text,p_organization_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare selected_id uuid;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
  raise exception 'platform access denied' using errcode='42501';
 end if;
 select a.id into selected_id from public.platform_access_assignments a
 join public.platform_role_permissions p on p.role_key=a.role_key and p.permission_key=p_permission
 where a.user_id=auth.uid() and a.revoked_at is null
 and a.valid_from<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp())
 and p_organization_id is not null
 and (a.scope_kind='platform' or a.organization_id=p_organization_id)
 order by a.id limit 1;
 if selected_id is null then raise exception 'platform access denied' using errcode='42501'; end if;
 return selected_id;
end; $$;
revoke all on function public.require_platform_permission(text,uuid) from public,anon,authenticated,service_role;

create function public.get_platform_organization_summary(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; result jsonb;
begin
 assignment:=public.require_platform_permission('organization.summary.read',p_organization_id);
 select jsonb_build_object('id',o.id,'name',o.name,'created_at',o.created_at)
 into result from public.organizations o where o.id=p_organization_id;
 if result is null then raise exception 'organization unavailable' using errcode='22023'; end if;
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action)
 values(auth.uid(),assignment,p_organization_id,'organization.summary.read');
 return result;
end; $$;
revoke all on function public.get_platform_organization_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_platform_organization_summary(uuid) to authenticated;
commit;
