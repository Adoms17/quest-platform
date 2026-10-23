begin;
-- Общий расчёт для чтения и операций под блокировкой. Не проверяет permissions.
create function public.resolve_subscription_quota_phase(
  s public.organization_subscriptions, p_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.billing_period_policy_bindings%rowtype; phase text;
begin
  select * into b from public.billing_period_policy_bindings where organization_id=s.organization_id;
  if found and b.valid and s.status in ('active','expired')
    and b.plan_version_id=s.plan_version_id and b.period_start=s.period_start and b.period_end=s.period_end then
    return public.evaluate_billing_lifecycle_policy(s.status,s.period_start,s.period_end,
      s.cancel_at_period_end,true,b.policy_version,p_at);
  end if;
  -- Без привязки сохраняется прежний контракт, без неявного grace.
  phase:=coalesce(s.status,'missing');
  if s.status='free' and not exists(select 1 from public.billing_plan_versions where id=s.plan_version_id and plan_key='free') then
    phase:='invalid';
  elsif s.status in ('active','trial') then
    if p_at>=s.period_end then phase:='expired';
    elsif p_at<s.period_start then phase:='not_started'; end if;
  end if;
  return jsonb_build_object('phase',phase,'grace_end',null,'policy_version',null);
end;
$$;
revoke all on function public.resolve_subscription_quota_phase(public.organization_subscriptions,timestamptz) from public,anon,authenticated;
create or replace function public.enforce_active_quest_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  quota integer;
  lifecycle jsonb;
  usage bigint;
begin
  if new.is_open is distinct from true then return null; end if;
  if tg_op='UPDATE' then
    if old.is_open is true and old.organization_id is not distinct from new.organization_id then return null; end if;
  end if;
  -- Одна блокировка на организацию сериализует открытия и смену её тарифа.
  select * into subscription from public.organization_subscriptions
    where organization_id=new.organization_id for update;
  if not coalesce(subscription.active_quest_quota_enabled,false) or subscription.status='transition' then return null; end if;
  -- Для snapshot isolation нельзя считать расход по устаревшему снимку.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'quest quota requires read committed' using errcode='40001';
  end if;
  lifecycle:=public.resolve_subscription_quota_phase(subscription,clock_timestamp());
  select p.active_quests_limit into quota from public.billing_plan_versions p
    where p.id=subscription.plan_version_id and lifecycle->>'phase' in ('free','active','trial','grace');
  if quota is null then
    raise exception 'quest quota unavailable' using errcode='P0001';
  end if;
  select count(*) into usage from public.quests where organization_id=new.organization_id and is_open is true;
  if usage > quota then
    raise exception 'active quest quota exceeded' using errcode='P0001';
  end if;
  return null;
end;
$$;
create or replace function public.enforce_team_member_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  quota integer;
  lifecycle jsonb;
  usage bigint;
begin
  if new.status <> 'active' then return null; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'active' and old.organization_id = new.organization_id then return null; end if;
  end if;
  select * into subscription from public.organization_subscriptions
    where organization_id = new.organization_id for update;
  if not coalesce(subscription.team_member_quota_enabled, false) or subscription.status = 'transition' then return null; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'team quota requires read committed' using errcode = '40001';
  end if;
  lifecycle:=public.resolve_subscription_quota_phase(subscription,clock_timestamp());
  select p.team_members_limit into quota from public.billing_plan_versions p
    where p.id=subscription.plan_version_id and lifecycle->>'phase' in ('free','active','trial','grace');
  if quota is null then raise exception 'team quota unavailable' using errcode = 'P0001'; end if;
  select count(distinct user_id) into usage from public.organization_memberships
    where organization_id = new.organization_id and status = 'active';
  if usage > quota then raise exception 'team member quota exceeded' using errcode = 'P0001'; end if;
  return null;
end;
$$;
create or replace function public.get_organization_billing_state(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  configured_plan jsonb;
  resolved_status text;
  plan_key text;
  lifecycle jsonb;
begin
  if not public.has_organization_permission(p_organization_id, 'billing.read') then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into subscription from public.organization_subscriptions where organization_id=p_organization_id;
  select p.plan_key, jsonb_build_object(
    'id',p.id,'key',p.plan_key,'version',p.version,'name',p.display_name,
    'limits',jsonb_build_object('active_quests',p.active_quests_limit,'team_members',p.team_members_limit)
  ) into plan_key, configured_plan from public.billing_plan_versions p where p.id=subscription.plan_version_id;
  lifecycle:=public.resolve_subscription_quota_phase(subscription,statement_timestamp());
  resolved_status:=lifecycle->>'phase';
  return jsonb_build_object(
    'organization_id',p_organization_id,'status',resolved_status,'stored_status',subscription.status,
    'grace_end',lifecycle->'grace_end','lifecycle_policy_version',lifecycle->'policy_version',
    'period_start',subscription.period_start,'period_end',subscription.period_end,
    'can_manage',public.has_organization_permission(p_organization_id,'billing.manage'),
    'configured_plan',configured_plan,'enforcement_enabled',coalesce(subscription.active_quest_quota_enabled,false) and subscription.status <> 'transition',
    'effective_entitlements',case when resolved_status in ('free','active','trial','grace') then configured_plan->'limits' else null end
  );
end;
$$;


commit;
