begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $fixture$
declare actor uuid; owner_count integer; org constant uuid:=md5('stage-fiscal-acceptance-org-20260928')::uuid;
 fixture constant uuid:=md5('stage-fiscal-acceptance-fixture-20260928')::uuid;
 membership uuid; free_plan uuid; paid_plan uuid; policy uuid;
 saved public.billing_fiscal_acceptance_fixtures%rowtype;
 subscription public.organization_subscriptions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('stage-fiscal-acceptance-fixture-20260928',0));
 select count(distinct user_id) into owner_count from public.platform_access_assignments
 where role_key='owner' and scope_kind='platform' and revoked_at is null and valid_from<=clock_timestamp();
 if owner_count<>1 then raise exception 'exactly one active platform owner required'; end if;
 select user_id into actor from public.platform_access_assignments
 where role_key='owner' and scope_kind='platform' and revoked_at is null and valid_from<=clock_timestamp() limit 1;
 select id into strict free_plan from public.billing_plan_versions where plan_key='free' and version=1;
 select id into strict paid_plan from public.billing_plan_versions where plan_key='pro' and version=1 and monthly_price_minor=99000;
 policy:=public.select_subscription_fiscal_policy('1467641',statement_timestamp());
 if not exists(select 1 from public.billing_fiscal_policy_models where policy_id=policy and model_version='subscription_access_v1') then
  raise exception 'modeled sandbox policy required'; end if;
 select * into saved from public.billing_fiscal_acceptance_fixtures where id=fixture for update;
 if found then
  if saved.organization_id<>org or saved.actor_id<>actor or saved.plan_version_id<>paid_plan
   or saved.order_id is not null or saved.expires_at<=clock_timestamp() then raise exception 'fixture already used, expired or mismatched'; end if;
 else
  if exists(select 1 from public.organizations where id=org or name='sandbox-fiscal-acceptance-20260928') then
   raise exception 'organization collision: preserve existing organization'; end if;
  insert into public.organizations(id,name) values(org,'sandbox-fiscal-acceptance-20260928');
  insert into public.organization_memberships(organization_id,user_id,status) values(org,actor,'active') returning id into membership;
  insert into public.membership_roles(membership_id,role_id) select membership,id from public.roles where key='owner';
  -- This row belongs exclusively to the organization inserted in this transaction.
  update public.organization_subscriptions set status='free',plan_version_id=free_plan,
   period_start=null,period_end=null,trial_access_id=null,scheduled_plan_version_id=null where organization_id=org;
  insert into public.billing_sandbox_application_scope(organization_id) values(org);
  select * into strict subscription from public.organization_subscriptions where organization_id=org for update;
  insert into public.billing_fiscal_acceptance_fixtures(id,organization_id,actor_id,plan_version_id,expected_revision,expires_at)
   values(fixture,org,actor,paid_plan,subscription.revision,clock_timestamp()+interval '2 hours') returning * into saved;
 end if;
 select * into strict subscription from public.organization_subscriptions where organization_id=org for update;
 if subscription.status<>'free' or subscription.plan_version_id<>free_plan or subscription.revision<>saved.expected_revision
  or subscription.period_start is not null or subscription.period_end is not null or subscription.trial_access_id is not null
  or subscription.scheduled_plan_version_id is not null
  or exists(select 1 from public.billing_sandbox_orders where organization_id=org)
  or exists(select 1 from public.billing_trial_paid_periods where organization_id=org)
  or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=org)
  or not exists(select 1 from public.organization_memberships m join public.membership_roles mr on mr.membership_id=m.id
   join public.roles r on r.id=mr.role_id where m.organization_id=org and m.user_id=actor and m.status='active' and r.key='owner') then
  raise exception 'fixture organization changed: manual review required'; end if;
end; $fixture$;
select id as fixture_id,organization_id,plan_version_id,expected_revision,expires_at,
 'sandbox' as environment,'1467641' as shop_id,99000 as amount_minor,30 as period_minutes
 from public.billing_fiscal_acceptance_fixtures where id=md5('stage-fiscal-acceptance-fixture-20260928')::uuid;
commit;
