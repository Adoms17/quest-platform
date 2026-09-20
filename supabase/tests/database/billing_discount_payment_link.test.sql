begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),5000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);

select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);

select is(platform_private.prepare_discount_payment(current_setting('test.order')::uuid),current_setting('test.order')::uuid,'денежный заказ связан с checkout');
select is((select amount_minor from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),6172::bigint,'провайдеру предназначена сумма после скидки с округлением');
select is(platform_private.prepare_discount_payment(current_setting('test.order')::uuid),current_setting('test.order')::uuid,'retry сохраняет идентификатор');
select is((select count(*) from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),1::bigint,'денежный заказ один');
select is((select first_sent_at from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),null::timestamptz,'подготовка не отправляет платёж');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','до подтверждения скидка не расходуется');
select throws_ok($t$select public.cancel_unsent_sandbox_order(current_setting('test.org')::uuid,current_setting('test.order')::uuid)$t$,'55000','discount checkout requires reconciliation','старый путь отмены не оставляет потерянный резерв');
select is(public.begin_sandbox_payment_send(current_setting('test.order')::uuid)#>>'{order,amountMinor}','6172','путь отправки получает итоговую сумму');
insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('discount-event')::uuid,current_setting('test.order')::uuid,md5('discount-provider-id')::uuid,'payment.succeeded');
select is(public.apply_sandbox_payment_event(md5('discount-event')::uuid,jsonb_build_object('paymentId',md5('discount-provider-id')::uuid,'status','succeeded','paid',true,'test',true))->>'reason','discount_reconciliation_required','старый обработчик не выдаёт доступ в обход нового контракта');
select is(public.process_billing_confirmation(current_setting('test.order')::uuid)->>'reason','discount_reconciliation_required','общий runner тоже не обходит новый контракт');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'подписка пока не изменена');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','успех до интеграции требует сверки, не теряет резерв');
select ok((select relrowsecurity from pg_class where oid='public.billing_discount_payment_links'::regclass),'RLS включён');
select ok(not has_function_privilege('authenticated','platform_private.prepare_discount_payment(uuid)','execute'),'клиент не создаёт неподключённый платёж');
select * from finish();rollback;
