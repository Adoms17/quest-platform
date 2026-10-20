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
    'configured_plan',configured_plan,'enforcement_enabled',coalesce(subscription.active_quest_quota_enabled,false) and subscription.status <> 'transition',
    'effective_entitlements',case when resolved_status in ('free','active','trial') then configured_plan->'limits' else null end
  );
end;
$$;
