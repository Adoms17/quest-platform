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
select is(current_setting('test.accepted')::jsonb->>'amount_minor','0','зафиксирован нулевой расчёт');
select is(current_setting('test.accepted')::jsonb->>'reserved','true','скидка зарезервирована атомарно с заказом');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE'),current_setting('test.accepted')::jsonb,'retry возвращает исходный заказ');
select is((select count(*) from public.billing_discount_checkouts where organization_id=current_setting('test.org')::uuid),1::bigint,'retry не создаёт другой заказ');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid),1::bigint,'retry не создаёт другой резерв');
select throws_ok($t$select platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'OTHER')$t$,'22023','discount checkout conflict','нельзя подменить код при retry');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,gen_random_uuid(),'WRONG')->>'reason','invalid_code','неверный код не создаёт заказ');
select is((select attempts from public.billing_discount_checks where actor_id=auth.uid()),2,'неверная проверка сохраняет счётчик');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),0::bigint,'нулевой расчёт не создаёт денежный платёж');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'принятие расчёта не выдаёт доступ');
select throws_ok($t$update public.billing_discount_checkouts set quote='{}'$t$,'55000',null,'принятый расчёт неизменяем');
select ok((select relrowsecurity from pg_class where oid='public.billing_discount_checkouts'::regclass),'RLS включён');
select ok(not has_table_privilege('authenticated','public.billing_discount_checkouts','select'),'чужие расчёты закрыты');
select ok(not has_function_privilege('authenticated','platform_private.accept_discount_checkout(uuid,uuid,uuid,text)','execute'),'незавершённый checkout не открыт клиенту');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,gen_random_uuid(),'TEST-CODE')->>'reason','checkout_pending','второй заказ организации ждёт завершения первого');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid),1::bigint,'отклонённый второй заказ не оставляет резерв');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($t$select platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,gen_random_uuid(),'TEST-CODE')$t$,'42501','billing management denied','чужой аккаунт не принимает предложение');
select * from finish();
rollback;
