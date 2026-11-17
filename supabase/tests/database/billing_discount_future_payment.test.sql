begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),5000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,gen_random_uuid(),0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),now()-interval '1 month',now()+interval '6 seconds');
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),1,12345,'123','https://stage.qvesta.ru',now()+interval '6 seconds',(((now()+interval '6 seconds') at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);

select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);


select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select throws_ok($t$select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)$t$,'55000','discount payment unverified','без доказательства оплаты доступа нет');
insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('paid-discount-event')::uuid,current_setting('test.order')::uuid,md5('paid-discount-provider')::uuid,'payment.succeeded');
select set_config('test.payment',jsonb_build_object('paymentId',md5('paid-discount-provider')::uuid,'status','succeeded','paid',true,'test',true)::text,true);
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,current_setting('test.payment')::jsonb)->>'fulfillmentState','deferred','будущий оплаченный период ожидает');
select is(public.process_billing_confirmation(current_setting('test.order')::uuid)->>'state','deferred','повтор до даты безопасен');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),1::bigint,'текущий период сохранён');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','скидка зарезервирована');
select ok(exists(select 1 from public.billing_sandbox_reconciliation_jobs where order_id=current_setting('test.order')::uuid),'заказ остаётся в очереди сверки');
savepoint conflict;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select is(public.process_billing_confirmation(current_setting('test.order')::uuid)->>'state','review','конфликт ревизии не скрыт отсрочкой');
rollback to conflict;
select ok(not has_function_privilege('authenticated','platform_private.defer_future_discount_payment(uuid)','execute'),'клиент не вызывает helper');
select throws_ok($t$select public.get_sandbox_order_offer(gen_random_uuid(),current_setting('test.order')::uuid)$t$,'42501',null,'чужой заказ закрыт');
select pg_sleep(6);
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,current_setting('test.payment')::jsonb)->>'fulfillmentState','applied','на дате начала период применяется');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','после выдачи скидка расходуется');
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,current_setting('test.payment')::jsonb)->>'fulfillmentState','applied','повтор после выдачи безопасен');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),2::bigint,'ревизия изменена один раз');
select is((select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.order')::uuid),1::bigint,'одно подтверждение');
select * from finish();rollback;