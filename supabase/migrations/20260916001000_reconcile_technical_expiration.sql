alter table public.billing_period_confirmations add column expiration_source_revision bigint;

create or replace function public.confirm_organization_subscription_period(
  p_organization_id uuid,p_confirmation_id uuid,p_expected_revision bigint,
  p_plan_version_id uuid,p_period_start timestamptz,p_period_end timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; target public.billing_plan_versions%rowtype;
  current_plan public.billing_plan_versions%rowtype; receipt public.billing_period_confirmations%rowtype;
  request jsonb; previous jsonb; result jsonb; expiration public.billing_expiration_events%rowtype; reconciled_revision bigint;
begin
  if p_confirmation_id is null or p_expected_revision is null or p_expected_revision<0
    or p_period_start is null or p_period_end is null or not isfinite(p_period_start) or not isfinite(p_period_end)
    or p_period_end<=p_period_start then raise exception 'invalid billing confirmation' using errcode='22023'; end if;
  -- Один серверный идентификатор нельзя применить к двум организациям.
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text,7350));
  request:=jsonb_build_object('organization_id',p_organization_id,'revision',p_expected_revision,'plan',p_plan_version_id,'start',p_period_start,'end',p_period_end);
  select * into receipt from public.billing_period_confirmations where confirmation_id=p_confirmation_id;
  if found then
    if receipt.request<>request then raise exception 'billing confirmation conflict' using errcode='22023'; end if;
    return receipt.result;
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  if s.revision<>p_expected_revision then
    select * into expiration from public.billing_expiration_events
      where organization_id=p_organization_id and source_revision=p_expected_revision;
    if not found or s.status<>'expired'
      or expiration.before_state->>'status' not in ('active','trial')
      or expiration.before_state->>'revision' is distinct from p_expected_revision::text
      or expiration.after_state->>'revision' is distinct from (p_expected_revision+1)::text
      or expiration.after_state is distinct from to_jsonb(s)
      or (expiration.before_state-'status'-'revision') is distinct from (expiration.after_state-'status'-'revision') then
      raise exception 'billing revision conflict' using errcode='40001';
    end if;
    reconciled_revision:=p_expected_revision;
  end if;
  if s.status='transition' then raise exception 'billing transition requires agreement' using errcode='P0001'; end if;
  if clock_timestamp()<p_period_start or clock_timestamp()>=p_period_end then
    raise exception 'confirmed billing period not current' using errcode='22023'; end if;
  select * into target from public.billing_plan_versions where id=p_plan_version_id;
  if target.id is null or target.plan_key='free' then raise exception 'invalid confirmed billing plan' using errcode='22023'; end if;
  select * into current_plan from public.billing_plan_versions where id=s.plan_version_id;
  if s.period_end is not null then
    if p_period_end<s.period_end or p_period_start<s.period_start then
      raise exception 'billing period regression' using errcode='22023'; end if;
    -- Перекрывающийся период: только продление прежнего интервала или upgrade.
    if p_period_start<s.period_end and (p_period_start<>s.period_start
      or target.active_quests_limit<current_plan.active_quests_limit or target.team_members_limit<current_plan.team_members_limit) then
      raise exception 'billing overlapping period conflict' using errcode='22023'; end if;
  end if;
  previous:=to_jsonb(s);
  update public.organization_subscriptions set status='active',plan_version_id=target.id,period_start=p_period_start,period_end=p_period_end
    where organization_id=p_organization_id returning * into s;
  result:=jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,'confirmation_id',p_confirmation_id);
  insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result,expiration_source_revision)
    values(p_confirmation_id,p_organization_id,request,previous,result,reconciled_revision);
  return result;
end;
$$;
revoke all on function public.confirm_organization_subscription_period(uuid,uuid,bigint,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_organization_subscription_period(uuid,uuid,bigint,uuid,timestamptz,timestamptz) to service_role;
comment on function public.confirm_organization_subscription_period(uuid,uuid,bigint,uuid,timestamptz,timestamptz) is
  'Внутренний примитив для уже проверенного серверного подтверждения. Сам не проверяет оплату/подпись webhook. Не подключён к провайдеру. Нельзя обновлять expected_revision старого события для обхода конфликта.';
