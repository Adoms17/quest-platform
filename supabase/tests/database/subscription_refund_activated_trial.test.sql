begin;
select no_plan();
insert into auth.users(id,email) values(md5('purchase-trial-owner')::uuid,'purchase-trial@example.test'),(md5('purchase-trial-other')::uuid,'purchase-trial-other@example.test');
select set_config('request.jwt.claim.sub',md5('purchase-trial-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit)
values(md5('purchase-trial-v1')::uuid,'purchase_trial',1,'Trial 1',5,3),
(md5('purchase-trial-v2')::uuid,'purchase_trial',2,'Trial 2',6,3),
(md5('purchase-trial-other-plan')::uuid,'purchase_other',1,'Other',2,1);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('purchase-trial-v1')::uuid,md5('purchase-trial-v1')::uuid,'purchase_trial',now()-interval '2 days'),
(md5('purchase-trial-other-plan')::uuid,md5('purchase-trial-other-plan')::uuid,'purchase_other',now()-interval '1 day');
select public.request_organization_trial(current_setting('test.org')::uuid,md5('purchase-trial-v1')::uuid,repeat('a',64),md5('purchase-trial-start')::uuid,0);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('purchase-trial-v2')::uuid,md5('purchase-trial-v2')::uuid,'purchase_trial',now()-interval '1 day');
select set_config('test.before',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);

update public.billing_trial_access set ends_at=clock_timestamp()+interval '5 seconds' where organization_id=current_setting('test.org')::uuid;
update public.organization_subscriptions set period_end=(select ends_at from public.billing_trial_access where organization_id=current_setting('test.org')::uuid) where organization_id=current_setting('test.org')::uuid;
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('trial-discount')::uuid,current_setting('test.org')::uuid,'purchase_trial',encode(extensions.digest('TRIAL-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-offer')::uuid,s.organization_id,md5('purchase-trial-v2')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',s.period_end,
 ((s.period_end at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);

insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select public.record_sandbox_payment_result(current_setting('test.order')::uuid,md5('trial-refund-payment')::uuid,'succeeded',true,true,null);
select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid);
-- Wait only for this synthetic five-second trial; real subscriptions are untouched.
select pg_sleep(greatest(0,extract(epoch from ((select period_end from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid)-clock_timestamp())))::double precision+0.05);
select public.advance_organization_trial(current_setting('test.org')::uuid);
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','trial runner activates paid period');
select ok((select trial_access_id is null from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'trial binding cleared by runner');
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
select set_config('test.request',public.request_platform_subscription_refund(current_setting('test.org')::uuid,current_setting('test.order')::uuid,gen_random_uuid())->>'id',true);
select platform_private.bind_subscription_refund_period(current_setting('test.request')::uuid);
select set_config('test.trial',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);
insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,provider_refund_id,first_sent_at)
values(md5('trial-confirmed-refund')::uuid,current_setting('test.order')::uuid,auth.uid(),gen_random_uuid(),(select amount_minor from public.subscription_refund_requests where id=current_setting('test.request')::uuid),md5('trial-refund-payment')::uuid,'succeeded',gen_random_uuid(),clock_timestamp());
insert into public.subscription_refund_reservations values(current_setting('test.request')::uuid,md5('trial-confirmed-refund')::uuid,clock_timestamp());
savepoint other_period;
update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id=current_setting('test.org')::uuid;
select throws_ok($$select platform_private.apply_current_subscription_refund(current_setting('test.request')::uuid)$$,'55000','subscription refund access review required','different paid period requires review');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','different access preserved');
select is((select count(*)::integer from public.subscription_refund_applications where request_id=current_setting('test.request')::uuid),0,'failed application leaves no cancellation');
rollback to savepoint other_period;
select set_config('test.applied',platform_private.apply_current_subscription_refund(current_setting('test.request')::uuid)::text,true);
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'free','refund terminates activated post-trial period');
select is((select plan_version_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),platform_private.current_tariff_version('free',clock_timestamp()),'uses current Free version');
select is((select count(*)::integer from platform_private.active_trial_paid_periods where organization_id=current_setting('test.org')::uuid),0,'refunded period excluded from active rights');
select is((select count(*)::integer from public.billing_trial_paid_periods where order_id=current_setting('test.order')::uuid),1,'paid history preserved');
select is(platform_private.apply_current_subscription_refund(current_setting('test.request')::uuid)::text,current_setting('test.applied'),'retry is stable');
select public.advance_organization_trial(current_setting('test.org')::uuid);
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'free','trial runner cannot reactivate refunded period');
select throws_ok($$select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)$$,'55000','subscription period refunded','old payment cannot reissue period');
select * from finish();
rollback;