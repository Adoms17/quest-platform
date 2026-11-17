begin;
select no_plan();
-- Только синтетический серверный снимок уже оплаченного периода и подтверждённого согласия.
insert into auth.users(id,email) values(md5('recurring-order-owner')::uuid,'recurring-order-owner@example.test');
select set_config('request.jwt.claim.sub',md5('recurring-order-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select set_config('test.ends',(now()+interval '1 day')::text,true);
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,md5('recurring-source-order')::uuid,0,current_setting('test.plan')::uuid,((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz);
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('recurring-source-offer')::uuid,current_setting('test.org')::uuid,current_setting('test.plan')::uuid,0,10000,'123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,now()-interval '1 day',1);
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,state,offer_id)
values(md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,0,5000,'RUB','123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,'finished',md5('recurring-source-offer')::uuid);
insert into public.billing_recurring_consents(id,order_id,organization_id,actor_id,terms_version)
values(md5('recurring-source-consent')::uuid,md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),'sandbox-recurring-v2');
insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
values(md5('recurring-source-consent')::uuid,'synthetic-method',gen_random_uuid());
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('refund-zero-code')::uuid,current_setting('test.org')::uuid,'pro',repeat('a',64),10000,2,1,now()-interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote,state,created_at,settled_at)
values(md5('refund-initial-benefit')::uuid,md5('refund-zero-code')::uuid,current_setting('test.org')::uuid,'{}','{}','consumed',now()-interval '3 days',now()-interval '2 days');
select set_config('test.prepared',platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,1)->>'order_id',true);
select is((select quote->>'amount_minor' from public.billing_recurring_orders where id=current_setting('test.prepared')::uuid),'0','renewal uses 100 percent discount');
select is(platform_private.apply_recurring_period(current_setting('test.prepared')::uuid)->>'state','deferred','without refund renewal waits for start');
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid) values(md5('recurring-source-order')::uuid,'123',md5('recurring-payment')::uuid,'succeeded',true);
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
select set_config('test.request',public.request_platform_subscription_refund(current_setting('test.org')::uuid,md5('recurring-source-order')::uuid,gen_random_uuid())->>'id',true);
savepoint before_refund;
select public.reserve_platform_subscription_refund(current_setting('test.request')::uuid);
select is(platform_private.apply_recurring_period(current_setting('test.prepared')::uuid)->>'reason','subscription_refund_pending','zero renewal blocked by refund');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'reserved','blocked renewal does not consume discount');
select is((select count(*)::integer from public.billing_period_confirmations where confirmation_id=current_setting('test.prepared')::uuid),0,'blocked renewal issues no period');
select is((select count(*)::integer from public.billing_recurring_attempts where order_id=current_setting('test.prepared')::uuid),0,'zero renewal never creates payment attempt');
rollback to before_refund;
select is(platform_private.apply_recurring_period(current_setting('test.prepared')::uuid)->>'state','deferred','rollback restores normal renewal checks');
select * from finish();rollback;