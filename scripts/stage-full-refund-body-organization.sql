begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $prepare$
declare actor uuid; owner_count integer; membership uuid; free_plan uuid; paid_plan uuid; policy uuid;
 org constant uuid:='e129101e-0878-5585-d3e8-207d76ef15c1';
begin
 perform pg_advisory_xact_lock(hashtextextended('stage-full-refund-body-20260930',0));
 select count(distinct user_id) into owner_count from public.platform_access_assignments
 where role_key='owner' and scope_kind='platform' and revoked_at is null and valid_from<=clock_timestamp();
 if owner_count<>1 then raise exception 'exactly one active platform owner required'; end if;
 select user_id into actor from public.platform_access_assignments
 where role_key='owner' and scope_kind='platform' and revoked_at is null and valid_from<=clock_timestamp() limit 1;
 free_plan:=platform_private.current_tariff_version('free',clock_timestamp());
 paid_plan:=platform_private.current_tariff_version('pro',clock_timestamp());
 if free_plan is null or not exists(select 1 from public.billing_plan_versions where id=paid_plan and monthly_price_minor=99000)
 then raise exception 'current Free and Pro at 990 RUB required'; end if;
 policy:=public.select_subscription_fiscal_policy('1467641',statement_timestamp());
 if not exists(select 1 from public.billing_fiscal_policy_models where policy_id=policy and model_version='subscription_access_v1')
 then raise exception 'modeled sandbox policy required'; end if;
 if not exists(select 1 from public.organizations where id=org) then
  if exists(select 1 from public.organizations where name='sandbox-full-refund-body-20260930') then raise exception 'organization collision'; end if;
  insert into public.organizations(id,name) values(org,'sandbox-full-refund-body-20260930');
  insert into public.organization_memberships(organization_id,user_id,status) values(org,actor,'active') returning id into membership;
  insert into public.membership_roles(membership_id,role_id) select membership,id from public.roles where key='owner';
  update public.organization_subscriptions set status='free',plan_version_id=free_plan,period_start=null,period_end=null,
   trial_access_id=null,scheduled_plan_version_id=null where organization_id=org;
  insert into public.billing_sandbox_application_scope(organization_id) values(org);
 end if;
 -- Retry only before use. Never reset an existing trial, subscription or purchase.
 if not exists(select 1 from public.organizations where id=org and name='sandbox-full-refund-body-20260930')
 or not exists(select 1 from public.organization_subscriptions where organization_id=org and status='free' and plan_version_id=free_plan
  and period_start is null and period_end is null and trial_access_id is null and scheduled_plan_version_id is null)
 or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=org)
 or not exists(select 1 from public.organization_memberships m join public.membership_roles mr on mr.membership_id=m.id
  join public.roles roles on roles.id=mr.role_id where m.organization_id=org and m.user_id=actor and m.status='active' and roles.key='owner')
 or exists(select 1 from public.billing_sandbox_orders where organization_id=org)
 or exists(select 1 from public.billing_trial_access where organization_id=org)
 or exists(select 1 from public.billing_trial_paid_periods where organization_id=org)
 then raise exception 'full refund organization changed: manual review required'; end if;
end; $prepare$;
select 'e129101e-0878-5585-d3e8-207d76ef15c1'::uuid as organization_id,'sandbox-full-refund-body-20260930' as organization_name,
 'sandbox' as environment,'1467641' as shop_id,99000 as expected_amount_minor;
commit;
