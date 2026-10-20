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
create function pg_temp.prepare() returns jsonb language sql as $$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,1)$$;
select set_config('test.prepared',pg_temp.prepare()->>'order_id',true);
create function pg_temp.review() returns jsonb language sql as $$select platform_private.review_recurring_order(current_setting('test.prepared')::uuid)$$;
select set_config('test.attempt',platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)::text,true);
create function pg_temp.claim() returns boolean language sql as $$select platform_private.claim_recurring_dispatch(current_setting('test.prepared')::uuid,(current_setting('test.attempt')::jsonb->>'idempotency_key')::uuid)$$;
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid) values(md5('recurring-source-order')::uuid,'123',md5('recurring-payment')::uuid,'succeeded',true);
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
select set_config('test.request',public.request_platform_subscription_refund(current_setting('test.org')::uuid,md5('recurring-source-order')::uuid,gen_random_uuid())->>'id',true);
savepoint before_reserve;
select lives_ok($$select public.reserve_platform_subscription_refund(current_setting('test.request')::uuid)$$,'refund may reserve before renewal dispatch');
select ok(not pg_temp.claim(),'reserved refund blocks renewal dispatch');
select is((select count(*)::integer from public.billing_recurring_dispatches),0,'blocked dispatch has no authorization');
rollback to before_reserve;
select ok(pg_temp.claim(),'dispatch may proceed after rolled back reservation');
select throws_ok($$select public.reserve_platform_subscription_refund(current_setting('test.request')::uuid)$$,'55000','subscription refund renewal reconciliation required','started renewal blocks refund reservation');
select is((select count(*)::integer from public.subscription_refund_reservations where request_id=current_setting('test.request')::uuid),0,'failed preflight leaves no refund reservation');
select public.revoke_sandbox_recurring_consent(current_setting('test.org')::uuid,md5('recurring-source-consent')::uuid);
select throws_ok($$select public.reserve_platform_subscription_refund(current_setting('test.request')::uuid)$$,'55000','subscription refund renewal reconciliation required','consent revocation does not hide dispatched payment');
insert into public.billing_recurring_results(order_id,payment_id,status,paid) values(current_setting('test.prepared')::uuid,gen_random_uuid(),'canceled',false);
select lives_ok($$select public.reserve_platform_subscription_refund(current_setting('test.request')::uuid)$$,'verified cancellation permits reservation');
select * from finish();rollback;