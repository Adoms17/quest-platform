begin;
select no_plan();
insert into auth.users(id,email) values(md5('renewal-owner')::uuid,'renewal-owner@example.test');
select set_config('request.jwt.claim.sub',md5('renewal-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('renewal-code')::uuid,current_setting('test.org')::uuid,'pro',repeat('e',64),5000,2,1,now()-interval '1 day',auth.uid(),gen_random_uuid());
create function pg_temp.renew(n integer) returns jsonb language sql as $$select platform_private.reserve_renewal_discount(md5('renewal-order-'||n)::uuid,current_setting('test.org')::uuid,'pro',1,10001)$$;
select is(pg_temp.renew(1)->>'discount_applied','false','выпущенный, но не активированный код не применяется автоматически');
-- Исторический успех: код активирован до дедлайна. Фикстура не меняет неизменяемые условия.
insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote,state,created_at,settled_at)
values(md5('renewal-initial')::uuid,md5('renewal-code')::uuid,current_setting('test.org')::uuid,'{}','{}','consumed',now()-interval '3 days',now()-interval '2 days');
select is(pg_temp.renew(1)->>'amount_minor','5000','активированная скидка работает после дедлайна, округление до копейки');
select is(pg_temp.renew(1)->>'discount_applied','true','код повторно вводить не нужно');
select is(pg_temp.renew(1),pg_temp.renew(1),'retry возвращает прежний расчёт');
select throws_ok($t$select pg_temp.renew(2)$t$,'55000','discount renewal pending','занятый последний период не заменяется полной ценой');
select throws_ok($t$select platform_private.reserve_renewal_discount(md5('renewal-order-1')::uuid,current_setting('test.org')::uuid,'pro',1,20000)$t$,'22023','discount order conflict','retry с другой ценой отклонён');
select is(platform_private.reserve_renewal_discount(gen_random_uuid(),current_setting('test.org')::uuid,'pro',12,10001)->>'discount_applied','false','месячная скидка не применяется к году');
select is(platform_private.reserve_renewal_discount(gen_random_uuid(),current_setting('test.org')::uuid,'another_plan',1,10001)->>'discount_applied','false','скидка не переносится на другой тариф');
select is(platform_private.reserve_renewal_discount(gen_random_uuid(),gen_random_uuid(),'pro',1,10001)->>'discount_applied','false','скидка другой организации не выбирается');
select is(platform_private.settle_discount_period(md5('renewal-order-1')::uuid,false),'released','неуспех освобождает льготу');
select is(pg_temp.renew(2)->>'amount_minor','5000','новый заказ использует освобождённую льготу');
select is(platform_private.settle_discount_period(md5('renewal-order-2')::uuid,true),'consumed','успех расходует оставшийся период');
select is(pg_temp.renew(3)->>'discount_applied','false','после двух успешных периодов скидка исчерпана');
select is(pg_temp.renew(2)->>'amount_minor','5000','retry успешного заказа сохраняет скидку после исчерпания');
select throws_ok($t$select pg_temp.renew(1)$t$,'55000','discount reservation released','освобождённый заказ нельзя возобновить');
select ok(not has_function_privilege('authenticated','platform_private.reserve_renewal_discount(uuid,uuid,text,integer,bigint)','execute'),'клиент не резервирует скидку с подставной ценой');
select ok(not has_function_privilege('service_role','platform_private.reserve_renewal_discount(uuid,uuid,text,integer,bigint)','execute'),'нет прямого RPC даже для service_role');
-- Отдельная организация: два бесплатных периода, включая первую покупку.
insert into auth.users(id,email) values(md5('renewal-zero-owner')::uuid,'renewal-zero-owner@example.test');
select set_config('request.jwt.claim.sub',md5('renewal-zero-owner')::uuid::text,true);
select set_config('test.zero_org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('renewal-zero-code')::uuid,current_setting('test.zero_org')::uuid,'pro',repeat('f',64),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
select platform_private.reserve_discount_period(md5('renewal-zero-initial')::uuid,current_setting('test.zero_org')::uuid,md5('renewal-zero-code')::uuid,'pro',1,10000);
select platform_private.settle_discount_period(md5('renewal-zero-initial')::uuid,true);
create function pg_temp.zero_renew(n integer) returns jsonb language sql as $$
select platform_private.reserve_renewal_discount(md5('renewal-zero-'||n)::uuid,current_setting('test.zero_org')::uuid,'pro',1,10000)$$;
select is(pg_temp.zero_renew(1)->>'amount_minor','0','100% скидка даёт нулевую стоимость продления');
select is(pg_temp.zero_renew(1),pg_temp.zero_renew(1),'повтор нулевого расчёта идемпотентен');
select is(platform_private.settle_discount_period(md5('renewal-zero-1')::uuid,false),'released','неуспешное предоставление бесплатного периода освобождает льготу');
select is(pg_temp.zero_renew(2)->>'amount_minor','0','после отказа остаётся бесплатный период');
select is(platform_private.settle_discount_period(md5('renewal-zero-2')::uuid,true),'consumed','успешный бесплатный период расходует льготу');
select is(platform_private.settle_discount_period(md5('renewal-zero-2')::uuid,true),'consumed','повтор подтверждения не расходует ещё один период');
select is(pg_temp.zero_renew(3)->>'discount_applied','false','после двух успешных периодов бесплатная льгота завершена');
select is(pg_temp.zero_renew(2)->>'amount_minor','0','старый успешный расчёт остаётся нулевым после исчерпания');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.zero_org')::uuid and state='consumed'),2::bigint,'ровно два использованных льготных периода');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.zero_org')::uuid),0::bigint,'резервирование и учёт нулевой скидки не создают платёжных заказов');
select * from finish();
rollback;
