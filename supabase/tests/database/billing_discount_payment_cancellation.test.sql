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
savepoint unsent;
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','до отправки можно отменить');
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','повтор отмены до отправки безопасен');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'released','до отправки резерв освобождается');
select is(public.begin_sandbox_payment_send(current_setting('test.order')::uuid)->>'can_send','false','отменённый заказ не отправляется');
rollback to unsent;
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select throws_ok($t$select public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid)$t$,'55000','discount payment requires reconciliation','после отправки нужна сверка');
select throws_ok($t$select platform_private.cancel_discount_payment(current_setting('test.order')::uuid,false)$t$,'55000','discount cancellation unverified','отсутствие ответа не означает отмену');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','неизвестный результат сохраняет резерв');
insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('cancel-discount-event')::uuid,current_setting('test.order')::uuid,md5('cancel-discount-provider')::uuid,'payment.canceled');
select set_config('test.canceled',jsonb_build_object('paymentId',md5('cancel-discount-provider')::uuid,'status','canceled','paid',false,'test',true)::text,true);
select is(public.apply_sandbox_payment_event(md5('cancel-discount-event')::uuid,current_setting('test.canceled')::jsonb)->>'reason','discount_payment_canceled','подтверждённая отмена обрабатывается');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'released','отмена провайдера освобождает скидку');
select is(public.apply_sandbox_payment_event(md5('cancel-discount-event')::uuid,current_setting('test.canceled')::jsonb)->>'reason','discount_payment_canceled','дубликат отмены безопасен');
select is(public.process_billing_confirmation(current_setting('test.order')::uuid)->>'state','not_paid','общая сверка сохраняет отмену');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'отмена не меняет подписку');
select is(public.apply_sandbox_payment_event(md5('cancel-discount-event')::uuid,jsonb_build_object('paymentId',md5('cancel-discount-provider')::uuid,'status','succeeded','paid',true,'test',true))->>'fulfillmentState','review','противоречивый поздний успех требует сверки');
select is((select count(*) from public.billing_discount_fulfillments where order_id=current_setting('test.order')::uuid),0::bigint,'противоречивый успех не выдаёт доступ');
select ok(not has_function_privilege('authenticated','platform_private.cancel_discount_payment(uuid,boolean)','execute'),'внутренняя отмена закрыта клиенту');
select * from finish();rollback;
