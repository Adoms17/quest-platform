begin;
select no_plan();
-- Только синтетический серверный снимок уже оплаченного периода и подтверждённого согласия.
insert into auth.users(id,email) values(md5('recurring-order-owner')::uuid,'recurring-order-owner@example.test');
select set_config('request.jwt.claim.sub',md5('recurring-order-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select set_config('test.ends',(now()+interval '1 day')::text,true);
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,gen_random_uuid(),0,current_setting('test.plan')::uuid,((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz);
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('recurring-source-offer')::uuid,current_setting('test.org')::uuid,current_setting('test.plan')::uuid,0,10000,'123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,now()-interval '1 day',1);
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,state,offer_id)
values(md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,0,5000,'RUB','123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,'reserved',md5('recurring-source-offer')::uuid);
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values(md5('recurring-fiscal-initial')::uuid,'sandbox','123',now()-interval '2 hours',1,'service','full_prepayment');
select public.prepare_sandbox_receipt(md5('recurring-source-order')::uuid,'receipt@example.test');
update public.billing_sandbox_orders set state='finished' where id=md5('recurring-source-order')::uuid;
insert into public.billing_recurring_consents(id,order_id,organization_id,actor_id,terms_version)
values(md5('recurring-source-consent')::uuid,md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),'sandbox-recurring-v2');
insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
values(md5('recurring-source-consent')::uuid,'synthetic-method',gen_random_uuid());
create function pg_temp.prepare() returns jsonb language sql as $$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,1)$$;
select set_config('test.prepared',pg_temp.prepare()->>'order_id',true);
create function pg_temp.review() returns jsonb language sql as $$select platform_private.review_recurring_order(current_setting('test.prepared')::uuid)$$;

set local role authenticated;
select throws_ok($t$select public.prepare_recurring_receipt(current_setting('test.prepared')::uuid)$t$,'42501',null,'browser cannot prepare recurring receipt');
reset role;
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values(md5('recurring-fiscal-current')::uuid,'sandbox','123',now()-interval '1 hour',2,'service','full_payment');
savepoint before_receipt;
set local role service_role;
select set_config('test.recurring.receipt',public.prepare_recurring_receipt(current_setting('test.prepared')::uuid)::text,true);
select is(current_setting('test.recurring.receipt')::jsonb->>'email','receipt@example.test','email from original receipt');
select is(current_setting('test.recurring.receipt')::jsonb->>'amount_minor','10000','new renewal amount, not original discounted amount');
select is(current_setting('test.recurring.receipt')::jsonb->>'vat_code','2','uses currently effective fiscal policy');
select is(public.prepare_recurring_receipt(current_setting('test.prepared')::uuid)::text,current_setting('test.recurring.receipt'),'retry preserves snapshot');
select throws_ok('select * from public.billing_recurring_receipt_snapshots','42501',null,'raw contacts inaccessible to service role');
reset role;
select is(platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)->>'state','prepared','attempt really starts after receipt snapshot');
select is(public.prepare_recurring_receipt(current_setting('test.prepared')::uuid)::text,current_setting('test.recurring.receipt'),'existing snapshot recoverable after attempt begins');
select throws_ok($t$update public.billing_recurring_receipt_snapshots set email='changed@example.test'$t$,'55000','fiscal record immutable','contact immutable');

select set_config('test.recurring.body',jsonb_build_object('amount',jsonb_build_object('value','100.00','currency','RUB'),'capture',true,'payment_method_id',a.provider_method_id,
 'metadata',jsonb_build_object('order_id',r.id,'organization_id',r.organization_id,'plan_version_id',r.plan_version_id,'environment','sandbox'),
 'receipt',jsonb_build_object('customer',jsonb_build_object('email',s.email),'items',jsonb_build_array(jsonb_build_object('description',s.description,'quantity','1.000','amount',jsonb_build_object('value','100.00','currency','RUB'),'vat_code',s.vat_code,'payment_subject',s.payment_subject,'payment_mode',s.payment_mode))))::text,true),set_config('test.recurring.key',a.idempotency_key::text,true)
 from public.billing_recurring_orders r join public.billing_recurring_attempts a on a.order_id=r.id join public.billing_recurring_receipt_snapshots s on s.order_id=r.id where r.id=current_setting('test.prepared')::uuid;
set local role authenticated;
select throws_ok($t$select public.save_recurring_receipt_request(current_setting('test.prepared')::uuid,current_setting('test.recurring.key')::uuid,current_setting('test.recurring.body')::jsonb)$t$,'42501',null,'browser cannot submit recurring receipt');
set local role service_role;
select set_config('test.recurring.request',public.save_recurring_receipt_request(current_setting('test.prepared')::uuid,current_setting('test.recurring.key')::uuid,current_setting('test.recurring.body')::jsonb)::text,true);
select is(public.save_recurring_receipt_request(current_setting('test.prepared')::uuid,current_setting('test.recurring.key')::uuid,current_setting('test.recurring.body')::jsonb)::text,current_setting('test.recurring.request'),'stable full request');
select throws_ok($t$select public.save_recurring_receipt_request(current_setting('test.prepared')::uuid,current_setting('test.recurring.key')::uuid,current_setting('test.recurring.body')::jsonb||'{"capture":false}'::jsonb)$t$,'22023','receipt request conflict','cannot change retry body');
select public.record_recurring_receipt_status(current_setting('test.prepared')::uuid,md5('recurring-fiscal-payment')::uuid,'pending');
select is(jsonb_array_length(public.list_pending_recurring_receipts(25,'123')),1,'pending receipt scheduled for GET');
select is(jsonb_array_length(public.list_pending_recurring_receipts(25,'456')),0,'other shop excluded');
select public.record_recurring_receipt_status(current_setting('test.prepared')::uuid,md5('recurring-fiscal-payment')::uuid,'succeeded');
select public.record_recurring_receipt_status(current_setting('test.prepared')::uuid,md5('recurring-fiscal-payment')::uuid,'pending');
select is(jsonb_array_length(public.list_pending_recurring_receipts(25,'123')),0,'registered receipt cannot regress');
select throws_ok('select * from public.billing_recurring_receipt_requests','42501',null,'raw body inaccessible');
reset role;
rollback to savepoint before_receipt;
reset role;
select is(platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)->>'state','prepared','fixture has started attempt without receipt');
set local role service_role;
select throws_ok($t$select public.prepare_recurring_receipt(current_setting('test.prepared')::uuid)$t$,'55000','receipt must precede recurring attempt','cannot invent receipt after attempt begins');
reset role;
select * from finish();rollback;
