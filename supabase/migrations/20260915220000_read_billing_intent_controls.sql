create function public.get_organization_billing_controls(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; state jsonb; targets jsonb; manageable boolean;
begin
  state:=public.get_organization_billing_intent(p_organization_id);
  select * into s from public.organization_subscriptions where organization_id=p_organization_id;
  manageable:=public.has_organization_permission(p_organization_id,'billing.manage');
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.display_name,'version',t.version,
    'active_quests',t.active_quests_limit,'team_members',t.team_members_limit) order by t.active_quests_limit,t.team_members_limit,t.version),'[]'::jsonb)
    into targets from public.billing_plan_versions t join public.billing_plan_versions c on c.id=s.plan_version_id
    where t.active_quests_limit<=c.active_quests_limit and t.team_members_limit<=c.team_members_limit
      and (t.active_quests_limit<c.active_quests_limit or t.team_members_limit<c.team_members_limit);
  return state||jsonb_build_object('can_manage',manageable,'can_request',coalesce(manageable and s.status='active'
    and statement_timestamp()>=s.period_start and statement_timestamp()<s.period_end,false),'downgrade_targets',targets);
end;
$$;
revoke all on function public.get_organization_billing_controls(uuid) from public,anon,authenticated;
grant execute on function public.get_organization_billing_controls(uuid) to authenticated;
