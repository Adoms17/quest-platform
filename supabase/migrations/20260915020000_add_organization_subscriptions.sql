-- Основа подписки без платежей и enforcement. Lifecycle расширяется отдельно.
begin;
create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_version_id uuid references public.billing_plan_versions(id) on delete restrict,
  status text not null default 'unconfigured' check (status in ('unconfigured', 'transition')),
  created_at timestamptz not null default now(),
  constraint transition_has_no_assigned_plan check (status <> 'transition' or plan_version_id is null)
);
comment on table public.organization_subscriptions is
  'Серверное состояние тарифного подключения. transition сохраняет прежние возможности; unconfigured и отсутствие строки не дают переходных прав. Платёжный lifecycle и enforcement ещё не подключены.';
alter table public.organization_subscriptions enable row level security;
revoke all on public.organization_subscriptions from anon, authenticated;
grant select on public.organization_subscriptions to authenticated;
create policy organization_subscriptions_read on public.organization_subscriptions
  for select to authenticated
  using (public.has_organization_permission(organization_id, 'billing.read'));

-- Блокируем конкурентное создание на короткое время установки триггера/backfill:
-- все существующие организации получают transition, все последующие — unconfigured.
lock table public.organizations in share row exclusive mode;
create function public.initialize_organization_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_subscriptions(organization_id, status)
    values (new.id, 'unconfigured') on conflict (organization_id) do nothing;
  return new;
end;
$$;
revoke all on function public.initialize_organization_subscription() from public, anon, authenticated;
create trigger initialize_organization_subscription
  after insert on public.organizations for each row
  execute function public.initialize_organization_subscription();

-- Повтор этой вставки не перезаписывает уже созданное серверное состояние.
insert into public.organization_subscriptions(organization_id, status)
  select id, 'transition' from public.organizations
  on conflict (organization_id) do nothing;
commit;
