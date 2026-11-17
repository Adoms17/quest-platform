create or replace function public.get_organization_billing_overview(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  billing_state jsonb;
begin
  -- Resolver проверяет billing.read до любого чтения использования.
  billing_state := public.get_organization_billing_state(p_organization_id);
  return billing_state || jsonb_build_object(
    'usage', jsonb_build_object(
      'active_quests', (select count(*) from public.quests where organization_id=p_organization_id and is_open is true),
      'team_members', (select count(distinct user_id) from public.organization_memberships where organization_id=p_organization_id and status='active')
    ),
    'enforcement', jsonb_build_object(
      'active_quests', billing_state->'enforcement_enabled',
      'team_members', coalesce((select team_member_quota_enabled and status <> 'transition' from public.organization_subscriptions where organization_id=p_organization_id), false)
    ),
    'measured_at', statement_timestamp()
  );
end;
$$;
revoke all on function public.get_organization_billing_overview(uuid) from public,anon,authenticated;
grant execute on function public.get_organization_billing_overview(uuid) to authenticated;
comment on function public.get_organization_billing_overview(uuid) is
  'Read-only кабинет: серверные счётчики текущего использования без списков людей. Медиа и участники за период пока не считаются; отсутствие этих полей не означает нулевой расход.';
