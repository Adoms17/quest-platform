-- Read-only основа resolver. Платёжный lifecycle и enforcement ещё не включены.
create function public.get_organization_billing_state(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  configured_plan jsonb;
begin
  if not public.has_organization_permission(p_organization_id, 'billing.read') then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into subscription from public.organization_subscriptions
    where organization_id = p_organization_id;
  if subscription.plan_version_id is not null then
    select jsonb_build_object(
      'id', id, 'key', plan_key, 'version', version, 'name', display_name,
      'limits', jsonb_build_object('active_quests', active_quests_limit, 'team_members', team_members_limit)
    ) into configured_plan from public.billing_plan_versions where id = subscription.plan_version_id;
  end if;
  return jsonb_build_object(
    'organization_id', p_organization_id,
    'status', coalesce(subscription.status, 'missing'),
    'can_manage', public.has_organization_permission(p_organization_id, 'billing.manage'),
    'configured_plan', configured_plan,
    'enforcement_enabled', false,
    'effective_entitlements', null
  );
end;
$$;
revoke all on function public.get_organization_billing_state(uuid) from public, anon, authenticated;
grant execute on function public.get_organization_billing_state(uuid) to authenticated;
comment on function public.get_organization_billing_state(uuid) is
  'Чтение состояния по billing.read. configured_plan — справочные условия, не доказательство оплаты или действующих прав. missing/unconfigured не подменяются Free или transition.';
