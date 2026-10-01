begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $offer$
declare org constant uuid:='64701955-543c-b77b-23ba-ede86feb8728';
 offer_id constant uuid:=md5('stage-full-refund-offer-20260929')::uuid;
 s public.organization_subscriptions%rowtype; g public.billing_trial_access%rowtype;
 saved public.billing_sandbox_offers%rowtype; target uuid; ends timestamptz; actor uuid; owner_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('stage-full-refund-offer-20260929',0));
 select count(distinct user_id) into owner_count from public.platform_access_assignments where role_key='owner' and scope_kind='platform' and revoked_at is null and valid_from<=clock_timestamp();
 if owner_count<>1 then raise exception 'exactly one active platform owner required'; end if;
 select user_id into actor from public.platform_access_assignments where role_key='owner' and scope_kind='platform' and revoked_at is null and valid_from<=clock_timestamp() limit 1;
 select * into s from public.organization_subscriptions where organization_id=org for update;
 select * into g from public.billing_trial_access where id=s.trial_access_id;
 target:=platform_private.current_tariff_version('pro',clock_timestamp());
 if s.status is distinct from 'trial' or g.id is null or g.state<>'active' or g.access_kind<>'trial'
 or not public.trial_access_matches(s,g) or g.ends_at<=clock_timestamp() or g.starts_at>clock_timestamp()
 or not exists(select 1 from public.billing_plan_versions where id=g.plan_version_id and plan_key='pro')
 or not exists(select 1 from public.billing_plan_versions where id=target and plan_key='pro' and monthly_price_minor=99000)
 or not exists(select 1 from public.organizations where id=org and name='sandbox-full-refund-20260929')
 or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=org)
 or not exists(select 1 from public.organization_memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles roles on roles.id=mr.role_id where m.organization_id=org and m.user_id=actor and m.status='active' and roles.key='owner')
 or exists(select 1 from public.billing_sandbox_orders where organization_id=org)
 or exists(select 1 from public.billing_trial_paid_periods where organization_id=org)
 then raise exception 'full refund offer preflight failed'; end if;
 if not exists(select 1 from public.billing_fiscal_policy_models where policy_id=public.select_subscription_fiscal_policy('1467641',statement_timestamp()) and model_version='subscription_access_v1') then raise exception 'modeled sandbox policy required'; end if;
 ends:=((g.ends_at at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow';
 select * into saved from public.billing_sandbox_offers where id=offer_id;
 if found then
  if saved.organization_id<>org or saved.plan_version_id<>target or saved.expected_revision<>s.revision
   or saved.amount_minor<>99000 or saved.shop_id<>'1467641' or saved.period_start<>g.ends_at or saved.period_end<>ends
   or saved.period_months<>1 or saved.valid_until<=clock_timestamp() or saved.return_url<>'https://stage.qvesta.ru/organization/billing'
  then raise exception 'full refund offer changed or expired'; end if;
 else
  if exists(select 1 from public.billing_sandbox_offers where organization_id=org) then raise exception 'full refund offer collision'; end if;
  insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
  values(offer_id,org,target,s.revision,99000,'1467641','https://stage.qvesta.ru/organization/billing',g.ends_at,ends,least(clock_timestamp()+interval '2 hours',g.ends_at),1);
 end if;
 if (select count(*) from public.purchase_document_versions where status='published')<>2
 or not exists(select 1 from public.purchase_document_versions where id='stage-test-agreement-20260926' and kind='agreement' and status='published')
 or not exists(select 1 from public.purchase_document_versions where id='stage-test-payment-20260926' and kind='payment_terms' and status='published')
 then raise exception 'expected stage test documents required'; end if;
 insert into public.checkout_document_scope(organization_id) values(org) on conflict do nothing;
end; $offer$;
select id as offer_id,amount_minor,shop_id,period_start,period_end,valid_until from public.billing_sandbox_offers where id=md5('stage-full-refund-offer-20260929')::uuid;
commit;
