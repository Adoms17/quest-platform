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


select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select throws_ok($t$select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)$t$,'55000','discount payment unverified','без доказательства оплаты доступа нет');
insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('paid-discount-event')::uuid,current_setting('test.order')::uuid,md5('paid-discount-provider')::uuid,'payment.succeeded');
select set_config('test.payment',jsonb_build_object('paymentId',md5('paid-discount-provider')::uuid,'status','succeeded','paid',true,'test',true)::text,true);
savepoint stale_subscription;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,current_setting('test.payment')::jsonb)->>'fulfillmentState','review','конфликт подписки требует сверки');
select is((select status from public.billing_sandbox_payment_results where order_id=current_setting('test.order')::uuid),'succeeded','доказательство оплаты сохраняется при конфликте выдачи');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','ошибка выдачи не расходует скидку');
rollback to stale_subscription;
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,current_setting('test.payment')::jsonb)->>'fulfillmentState','applied','проверенный успешный платёж выдаёт период');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','успех расходует скидку');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','доступ активен');
select set_config('test.revision',(select revision::text from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),true);
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,current_setting('test.payment')::jsonb)->>'fulfillmentState','applied','дубликат события безопасен');
select is((select revision::text from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),current_setting('test.revision'),'дубликат не меняет подписку');
select is((select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.order')::uuid),1::bigint,'подтверждение периода одно');
select is(public.process_billing_confirmation(current_setting('test.order')::uuid)->>'state','applied','повтор из общего runner безопасен');
select is((select amount_minor from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),6172::bigint,'подтверждён заказ на сумму после скидки');
select ok(not has_function_privilege('authenticated','platform_private.fulfill_discount_payment(uuid)','execute'),'клиент не подтверждает себе оплату');
select is(public.apply_sandbox_payment_event(md5('paid-discount-event')::uuid,jsonb_build_object('paymentId',md5('paid-discount-provider')::uuid,'status','canceled','paid',false,'test',true))->>'fulfillmentState','review','отмена после успеха требует сверки');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','поздняя отмена не возвращает использованную скидку');
select is((select revision::text from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),current_setting('test.revision'),'поздняя отмена не отнимает выданный период');
select is(public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)#>>'{discount,base_amount_minor}','12345','чтение возвращает исходную цену');
select is(public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)#>>'{discount,discount_amount_minor}','6173','чтение возвращает серверную скидку');
select ok(not (public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid) ? 'code_hash'),'хэш кода не раскрывается');
select ok(not has_function_privilege('authenticated','public.get_sandbox_order_offer_before_discount(uuid,uuid)','execute'),'обход нового чтения закрыт');
select throws_ok($t$select public.get_sandbox_order_offer(gen_random_uuid(),current_setting('test.order')::uuid)$t$,'42501',null,'чужая организация не может прочитать заказ');
select * from finish();rollback;
