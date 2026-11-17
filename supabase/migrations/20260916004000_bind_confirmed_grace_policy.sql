begin;
-- Старым подтверждениям политика задним числом не назначается.
alter table public.billing_period_confirmations add column lifecycle_policy_version integer
  references public.billing_lifecycle_policy_versions(version);
create table public.billing_period_policy_bindings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  confirmation_id uuid not null references public.billing_period_confirmations(confirmation_id) on delete cascade,
  policy_version integer not null references public.billing_lifecycle_policy_versions(version),
  plan_version_id uuid not null references public.billing_plan_versions(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  valid boolean not null default true
);
alter table public.billing_period_policy_bindings enable row level security;
revoke all on public.billing_period_policy_bindings from public,anon,authenticated;

create function public.stamp_confirmed_lifecycle_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- v1 — утверждённые 120 часов. Новая версия каталога сама не меняет выбор.
  new.lifecycle_policy_version:=1;
  return new;
end;
$$;
create trigger stamp_confirmed_lifecycle_policy before insert on public.billing_period_confirmations
for each row execute function public.stamp_confirmed_lifecycle_policy();

create function public.bind_confirmed_lifecycle_policy() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype;
begin
  select * into s from public.organization_subscriptions where organization_id=new.organization_id for update;
  if not found or s.status<>'active' or s.plan_version_id::text is distinct from new.request->>'plan'
    or s.period_start is distinct from (new.request->>'start')::timestamptz
    or s.period_end is distinct from (new.request->>'end')::timestamptz
    or s.revision::text is distinct from new.result->>'revision' then
    raise exception 'billing policy confirmation mismatch' using errcode='40001';
  end if;
  insert into public.billing_period_policy_bindings(organization_id,confirmation_id,policy_version,plan_version_id,period_start,period_end)
    values(s.organization_id,new.confirmation_id,new.lifecycle_policy_version,s.plan_version_id,s.period_start,s.period_end)
  on conflict(organization_id) do update set confirmation_id=excluded.confirmation_id,
    policy_version=excluded.policy_version,plan_version_id=excluded.plan_version_id,
    period_start=excluded.period_start,period_end=excluded.period_end,valid=true;
  return null;
end;
$$;
create trigger bind_confirmed_lifecycle_policy after insert on public.billing_period_confirmations
for each row execute function public.bind_confirmed_lifecycle_policy();

create function public.invalidate_billing_period_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.plan_version_id is distinct from old.plan_version_id
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
    or new.status not in ('active','expired') then
    update public.billing_period_policy_bindings set valid=false where organization_id=new.organization_id and valid;
  end if;
  return null;
end;
$$;
create trigger invalidate_billing_period_policy after update on public.organization_subscriptions
for each row execute function public.invalidate_billing_period_policy();
revoke all on function public.stamp_confirmed_lifecycle_policy(),public.bind_confirmed_lifecycle_policy(),public.invalidate_billing_period_policy()
from public,anon,authenticated;

-- Для атомарных операций: держит блокировку подписки до конца вызывающей транзакции.
create function public.lock_organization_billing_policy(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; b public.billing_period_policy_bindings%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'billing policy requires read committed' using errcode='40001';
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  select * into b from public.billing_period_policy_bindings where organization_id=p_organization_id;
  if not found or not b.valid or s.status not in ('active','expired')
    or b.plan_version_id is distinct from s.plan_version_id or b.period_start is distinct from s.period_start
    or b.period_end is distinct from s.period_end then
    return jsonb_build_object('organization_id',p_organization_id,'subscription_revision',s.revision,
      'binding_status','unbound','policy_enforced',false);
  end if;
  return public.evaluate_billing_lifecycle_policy(s.status,s.period_start,s.period_end,
    s.cancel_at_period_end,true,b.policy_version,clock_timestamp())
    || jsonb_build_object('organization_id',p_organization_id,'subscription_revision',s.revision,
      'binding_status','bound','confirmation_id',b.confirmation_id);
end;
$$;
revoke all on function public.lock_organization_billing_policy(uuid) from public,anon,authenticated;
grant execute on function public.lock_organization_billing_policy(uuid) to service_role;
comment on function public.lock_organization_billing_policy(uuid) is
  'Внутренний расчёт под блокировкой для будущих атомарных операций. unbound не даёт разрешения: необходим отдельный переходный путь. Не подключён к enforcement; вызов отдельным RPC не защищает следующую транзакцию.';
commit;
