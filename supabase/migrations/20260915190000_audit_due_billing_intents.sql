-- Наблюдение границы периода, не исполнение смены тарифа и не платёж.
create table public.billing_intent_evaluations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_revision bigint not null,
  outcome text not null check(outcome in ('due','stale')),
  snapshot jsonb not null,
  evaluated_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,subscription_revision)
);
alter table public.billing_intent_evaluations enable row level security;
revoke all on public.billing_intent_evaluations from public,anon,authenticated;

create function public.evaluate_organization_billing_intent(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; evaluation public.billing_intent_evaluations%rowtype;
  outcome text; checked_at timestamptz;
begin
  select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  -- Время берётся после ожидания блокировки, не в начале запроса.
  checked_at:=clock_timestamp();
  outcome:=case
    when s.scheduled_plan_version_id is null then 'none'
    when s.scheduled_intent_stale or s.scheduled_source_plan_version_id is null
      or s.scheduled_source_period_start is null or s.scheduled_source_period_end is null
      or s.scheduled_source_plan_version_id is distinct from s.plan_version_id
      or s.scheduled_source_period_start is distinct from s.period_start
      or s.scheduled_source_period_end is distinct from s.period_end
      or s.scheduled_effective_at is distinct from s.period_end
      or s.status not in ('active','expired') then 'stale'
    when checked_at>=s.scheduled_effective_at then 'due'
    else 'scheduled' end;
  -- Ранний вызов не фиксирует receipt: та же revision может позже стать due.
  if outcome in ('none','scheduled') then
    return jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,'outcome',outcome,'recorded',false);
  end if;
  insert into public.billing_intent_evaluations(organization_id,subscription_revision,outcome,snapshot,evaluated_at)
    values(s.organization_id,s.revision,outcome,to_jsonb(s),checked_at)
    on conflict(organization_id,subscription_revision) do nothing;
  select * into evaluation from public.billing_intent_evaluations
    where organization_id=s.organization_id and subscription_revision=s.revision;
  return jsonb_build_object('organization_id',evaluation.organization_id,'revision',evaluation.subscription_revision,
    'outcome',evaluation.outcome,'recorded',true,'evaluated_at',evaluation.evaluated_at);
end;
$$;
revoke all on function public.evaluate_organization_billing_intent(uuid) from public,anon,authenticated;
grant execute on function public.evaluate_organization_billing_intent(uuid) to service_role;
comment on function public.evaluate_organization_billing_intent(uuid) is
  'Только сервер: проверка downgrade под блокировкой, один результат на revision. Не исполняет смену, не подтверждает оплату, не изменяет entitlements. Планировщик не подключён.';
