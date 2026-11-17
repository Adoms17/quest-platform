-- Только нормализованные подтверждения доверенного адаптера, без raw webhook/секретов.
create table public.billing_confirmation_inbox (
  confirmation_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expected_revision bigint not null check(expected_revision>=0),
  plan_version_id uuid not null references public.billing_plan_versions(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  state text not null default 'pending' check(state in ('pending','deferred','review','applied')),
  reason text,
  result jsonb,
  received_at timestamptz not null default clock_timestamp(),
  checked_at timestamptz,
  check(isfinite(period_start) and isfinite(period_end) and period_end>period_start)
);
alter table public.billing_confirmation_inbox enable row level security;
revoke all on public.billing_confirmation_inbox from public,anon,authenticated;

create function public.enqueue_billing_confirmation(p_organization_id uuid,p_confirmation_id uuid,p_expected_revision bigint,
  p_plan_version_id uuid,p_period_start timestamptz,p_period_end timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.billing_confirmation_inbox%rowtype; prior public.billing_period_confirmations%rowtype; payload jsonb;
begin
  if p_confirmation_id is null or p_organization_id is null or p_expected_revision is null or p_expected_revision<0
    or p_plan_version_id is null or p_period_start is null or p_period_end is null
    or not isfinite(p_period_start) or not isfinite(p_period_end) or p_period_end<=p_period_start then
    raise exception 'invalid billing confirmation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text,7350));
  payload:=jsonb_build_object('organization_id',p_organization_id,'revision',p_expected_revision,'plan',p_plan_version_id,'start',p_period_start,'end',p_period_end);
  select * into prior from public.billing_period_confirmations where confirmation_id=p_confirmation_id;
  if found and prior.request<>payload then raise exception 'billing confirmation conflict' using errcode='22023'; end if;
  select * into item from public.billing_confirmation_inbox where confirmation_id=p_confirmation_id;
  if found then
    if item.organization_id is distinct from p_organization_id or item.expected_revision is distinct from p_expected_revision
      or item.plan_version_id is distinct from p_plan_version_id or item.period_start is distinct from p_period_start
      or item.period_end is distinct from p_period_end then
      raise exception 'billing confirmation conflict' using errcode='22023'; end if;
  else
    insert into public.billing_confirmation_inbox(confirmation_id,organization_id,expected_revision,plan_version_id,period_start,period_end)
      values(p_confirmation_id,p_organization_id,p_expected_revision,p_plan_version_id,p_period_start,p_period_end) returning * into item;
  end if;
  return jsonb_build_object('confirmation_id',item.confirmation_id,'state',item.state);
end;
$$;

create function public.process_billing_confirmation(p_confirmation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.billing_confirmation_inbox%rowtype; response jsonb; next_state text; outcome_reason text;
  detail text; subscription public.organization_subscriptions%rowtype;
begin
  if p_confirmation_id is null then raise exception 'invalid billing confirmation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text,7350));
  select * into item from public.billing_confirmation_inbox where confirmation_id=p_confirmation_id for update;
  if not found then raise exception 'billing confirmation missing' using errcode='P0001'; end if;
  if item.state in ('review','applied') then
    return jsonb_build_object('confirmation_id',item.confirmation_id,'state',item.state,'reason',item.reason,'result',item.result);
  end if;
  -- Сначала существующий receipt: истечение времени не отменяет успешное подтверждение.
  begin
    response:=public.confirm_organization_subscription_period(item.organization_id,item.confirmation_id,item.expected_revision,
      item.plan_version_id,item.period_start,item.period_end);
    next_state:='applied';
  exception when sqlstate '22023' or sqlstate '40001' or sqlstate 'P0001' then
    get stacked diagnostics detail=MESSAGE_TEXT;
    -- Только ожидаемые доменные отказы. Неизвестные ошибки не превращаем в подтверждённый приём.
    if detail not in ('billing revision conflict','billing transition requires agreement','confirmed billing period not current',
      'invalid confirmed billing plan','billing period regression','billing overlapping period conflict','billing confirmation conflict','billing state missing') then raise; end if;
    next_state:='review';
    outcome_reason:=case detail when 'billing revision conflict' then 'revision_conflict'
      when 'billing transition requires agreement' then 'transition_agreement'
      when 'confirmed billing period not current' then 'elapsed_period'
      when 'billing confirmation conflict' then 'identity_conflict'
      when 'billing state missing' then 'subscription_missing' else 'incompatible_terms' end;
    if detail='confirmed billing period not current' and clock_timestamp()<item.period_start then
      -- Блокировка внутри откатившегося подблока снята: проверяем заново под блокировкой.
      select * into subscription from public.organization_subscriptions where organization_id=item.organization_id for update;
      if subscription.revision=item.expected_revision then next_state:='deferred'; outcome_reason:='future_period';
      else outcome_reason:='revision_conflict'; end if;
    end if;
  end;
  update public.billing_confirmation_inbox set state=next_state,reason=outcome_reason,
    result=response,checked_at=clock_timestamp() where confirmation_id=p_confirmation_id returning * into item;
  return jsonb_build_object('confirmation_id',item.confirmation_id,'state',item.state,'reason',item.reason,'result',item.result);
end;
$$;
revoke all on function public.enqueue_billing_confirmation(uuid,uuid,bigint,uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.process_billing_confirmation(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_billing_confirmation(uuid,uuid,bigint,uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.process_billing_confirmation(uuid) to service_role;
comment on function public.process_billing_confirmation(uuid) is
  'Обрабатывает сохранённые исходные параметры. deferred допускает повтор; review требует отдельной сверки, без подстановки новой revision. Нет автоматического расписания/провайдера.';
