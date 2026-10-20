begin;
alter table public.organization_subscriptions
  drop constraint organization_subscriptions_status_check,
  add column period_start timestamptz,
  add column period_end timestamptz,
  add constraint organization_subscriptions_status_check
    check (status in ('unconfigured','transition','free','trial','active','expired')),
  add constraint billing_period_shape check (
    (status in ('unconfigured','transition','free') and period_start is null and period_end is null)
    or (status in ('trial','active','expired') and plan_version_id is not null
      and period_start is not null and period_end is not null and period_end > period_start)
  ),
  add constraint billing_free_has_plan check (status <> 'free' or plan_version_id is not null);

create or replace function public.get_organization_billing_state(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  configured_plan jsonb;
  resolved_status text;
  plan_key text;
begin
  if not public.has_organization_permission(p_organization_id, 'billing.read') then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into subscription from public.organization_subscriptions where organization_id=p_organization_id;
  select p.plan_key, jsonb_build_object(
    'id',p.id,'key',p.plan_key,'version',p.version,'name',p.display_name,
    'limits',jsonb_build_object('active_quests',p.active_quests_limit,'team_members',p.team_members_limit)
  ) into plan_key, configured_plan from public.billing_plan_versions p where p.id=subscription.plan_version_id;
  resolved_status := coalesce(subscription.status,'missing');
  if subscription.status='free' and plan_key is distinct from 'free' then
    resolved_status := 'invalid';
  elsif subscription.status in ('active','trial') then
    if statement_timestamp() >= subscription.period_end then
      resolved_status := 'expired';
    elsif statement_timestamp() < subscription.period_start then
      resolved_status := 'not_started';
    end if;
  end if;
  return jsonb_build_object(
    'organization_id',p_organization_id,'status',resolved_status,'stored_status',subscription.status,
    'period_start',subscription.period_start,'period_end',subscription.period_end,
    'can_manage',public.has_organization_permission(p_organization_id,'billing.manage'),
    'configured_plan',configured_plan,'enforcement_enabled',false,
    'effective_entitlements',case when resolved_status in ('free','active','trial') then configured_plan->'limits' else null end
  );
end;
$$;
comment on function public.get_organization_billing_state(uuid) is
  'Серверный resolver: период [start,end), истечение вычисляется при чтении. Сроки задаются отдельно, enforcement выключен; RPC не подтверждает платежи и не изменяет роли.';
commit;
