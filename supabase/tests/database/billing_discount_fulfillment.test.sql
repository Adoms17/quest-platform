begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);

select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
savepoint before_conflict;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select throws_ok($t$select platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid)$t$,'40001','billing revision conflict','устаревшая покупка не обходит конфликт ревизии');
select is((select state from public.billing_discount_checkout_states where order_id=current_setting('test.order')::uuid),'ready','ошибка подтверждения откатывает начало исполнения');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','ошибка не расходует льготу');
rollback to before_conflict;
savepoint before_cancel;
select platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid);
select throws_ok($t$select platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid)$t$,'55000','discount checkout not executable','отменённый заказ не выдаёт доступ');
rollback to before_cancel;
select set_config('test.result',platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid)::text,true);
select is(current_setting('test.result')::jsonb->>'status','completed','100 процентов выдаёт период без денежного платежа');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','подписка активирована');
select is((select plan_version_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),(select plan_version_id from public.billing_sandbox_offers where id=md5('discounted-offer')::uuid),'выдана зафиксированная версия');
select is((select period_end from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),(select period_end from public.billing_sandbox_offers where id=md5('discounted-offer')::uuid),'выдан согласованный период');
select is(platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid),current_setting('test.result')::jsonb,'retry возвращает прежнее подтверждение');
select is((select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.order')::uuid),1::bigint,'одно подтверждение периода');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','льготный период расходуется один раз');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),0::bigint,'платёж провайдера не создаётся');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')->>'status','completed','retry принятия показывает исполнение');
select throws_ok($t$select platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid)$t$,'55000','discount checkout requires reconciliation','исполненный заказ нельзя отменить как неисполненный');
select ok((select relrowsecurity from pg_class where oid='public.billing_discount_fulfillments'::regclass),'RLS подтверждений включён');
select ok(not has_function_privilege('authenticated','platform_private.fulfill_zero_discount_checkout(uuid)','execute'),'клиент не выдаёт себе период');
select ok(not has_table_privilege('authenticated','public.billing_discount_fulfillments','insert'),'клиент не подделывает подтверждение');
select * from finish();
rollback;
