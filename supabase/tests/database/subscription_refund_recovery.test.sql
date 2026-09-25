begin;
select no_plan();
insert into auth.users(id,email) values(md5('subscription-refund-owner')::uuid,'subscription-refund@example.test');
select set_config('request.jwt.claim.sub',md5('subscription-refund-owner')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
select set_config('test.order',public.reserve_sandbox_payment_order(current_setting('test.org')::uuid,gen_random_uuid(),0,platform_private.current_tariff_version('pro',clock_timestamp()),1000,'123','https://stage.qvesta.ru',now()+interval '1 day',now()+interval '31 days')->>'id',true);
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select public.record_sandbox_payment_result(current_setting('test.order')::uuid,md5('subscription-refund-payment')::uuid,'succeeded',true,true,null);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.receipt',public.request_platform_subscription_refund(current_setting('test.org')::uuid,current_setting('test.order')::uuid,md5('subscription-refund-command')::uuid)::text,true);
select is((current_setting('test.receipt')::jsonb->>'amount_minor'),'1000','future period fully refundable');
select is((current_setting('test.receipt')::jsonb->>'reserved'),'false','receipt does not reserve money');
select is(public.request_platform_subscription_refund(current_setting('test.org')::uuid,current_setting('test.order')::uuid,md5('subscription-refund-command')::uuid)::text,current_setting('test.receipt'),'retry preserves receipt and time');
select is(public.request_platform_subscription_refund(current_setting('test.org')::uuid,current_setting('test.order')::uuid,gen_random_uuid())->>'id',current_setting('test.receipt')::jsonb->>'id','new command cannot create second request for same order');
select throws_ok($$select public.request_platform_subscription_refund(gen_random_uuid(),current_setting('test.order')::uuid,md5('subscription-refund-command')::uuid)$$,'22023','subscription refund request conflict','cannot change organization on retry');
select is((select count(*)::integer from public.billing_sandbox_refunds where order_id=current_setting('test.order')::uuid),0,'no payment reserve created');
select ok((select relrowsecurity from pg_class where oid='public.subscription_refund_requests'::regclass),'RLS enabled');
set local role authenticated;
select throws_ok($$select * from public.subscription_refund_requests$$,'42501',null,'direct reads denied');
select throws_ok($$select public.request_platform_subscription_refund(null,null,null)$$,'42501',null,'RPC not enabled before integration');
set local role anon;
select throws_ok($$select * from public.subscription_refund_requests$$,'42501',null,'anonymous read denied');
set local role service_role;
select throws_ok($$select public.request_platform_subscription_refund(null,null,null)$$,'42501',null,'service RPC not prematurely enabled');
reset role;
-- A payment alone is not a license to change an arbitrary subscription.
select throws_ok($$select public.reserve_platform_subscription_refund((current_setting('test.receipt')::jsonb->>'id')::uuid)$$,'55000','subscription refund period not issued','unissued period cannot be reserved by termination flow');
select is((select count(*)::integer from public.subscription_refund_period_bindings),0,'failed binding leaves no row');
-- Trusted fixture: immutable confirmation for exactly the paid order.
update public.organization_subscriptions s set status='active',plan_version_id=o.plan_version_id,period_start=o.period_start,period_end=o.period_end from public.billing_sandbox_orders o where o.id=current_setting('test.order')::uuid and s.organization_id=o.organization_id;
insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
select id,organization_id,jsonb_build_object('plan',plan_version_id,'start',period_start,'end',period_end),'{}',jsonb_build_object('revision',(select revision from public.organization_subscriptions where organization_id=public.billing_sandbox_orders.organization_id))
from public.billing_sandbox_orders where id=current_setting('test.order')::uuid;
savepoint changed_period;
update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id=current_setting('test.org')::uuid;
select throws_ok($$select public.reserve_platform_subscription_refund((current_setting('test.receipt')::jsonb->>'id')::uuid)$$,'55000','subscription refund access review required','changed period rejected before reservation');
select is((select count(*)::integer from public.subscription_refund_reservations where request_id=(current_setting('test.receipt')::jsonb->>'id')::uuid),0,'no money reserved for changed period');
rollback to changed_period;
savepoint before_reserve;
select set_config('test.reserve',public.reserve_platform_subscription_refund((current_setting('test.receipt')::jsonb->>'id')::uuid)::text,true);
-- Synthetic expired authorization, created directly only in this rolled-back test.
insert into public.subscription_refund_dispatches(refund_id,actor_id,authorized_at,request_snapshot) values(current_setting('test.reserve')::uuid,auth.uid(),clock_timestamp()-interval '24 hours',jsonb_build_object('refund_id',current_setting('test.reserve')::uuid,'idempotency_key',current_setting('test.reserve')::uuid,'payment_id',md5('subscription-refund-payment')::uuid,'amount_minor',1000,'currency','RUB','shop_id','123'));
update public.billing_sandbox_refunds set state='sending',first_sent_at=(select authorized_at from public.subscription_refund_dispatches where refund_id=current_setting('test.reserve')::uuid) where id=current_setting('test.reserve')::uuid;
select is(platform_private.prepare_subscription_refund_recovery(current_setting('test.reserve')::uuid)->>'action','manual_review','expired idempotency window forbids resending');
select is(platform_private.claim_subscription_refund_dispatch(current_setting('test.reserve')::uuid)->>'can_send','false','expiry cannot create fresh authorization');
select is((select count(*)::integer from public.subscription_refund_dispatches),1,'recovery does not create a new dispatch');
set local role service_role;
select throws_ok($$select platform_private.prepare_subscription_refund_recovery(null)$$,'42501',null,'recovery closed until gateway integration');
reset role;
select * from finish();rollback;