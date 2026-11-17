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
values(md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,0,5000,'RUB','123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,'finished',md5('recurring-source-offer')::uuid);
insert into public.billing_recurring_consents(id,order_id,organization_id,actor_id,terms_version)
values(md5('recurring-source-consent')::uuid,md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),'sandbox-recurring-v2');
insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
values(md5('recurring-source-consent')::uuid,'synthetic-method',gen_random_uuid());
create function pg_temp.prepare() returns jsonb language sql as $$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,1)$$;
select throws_ok($t$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,0)$t$,'40001','recurring subscription changed','устаревшая ревизия запрещена');
select throws_ok($t$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,now()+interval '5 days',1)$t$,'40001','recurring subscription changed','нельзя выбрать постороннюю дату начала');
-- Изменения фикстуры откатываются, пользовательские подписки не затрагиваются.
savepoint cancellation;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select throws_ok($t$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,(select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid))$t$,'40001','recurring subscription changed','отмена продления блокирует подготовку');
rollback to cancellation;
savepoint support;
update public.billing_tariff_timeline set support_ends_at=current_setting('test.ends')::timestamptz,support_notice_at=current_setting('test.ends')::timestamptz-interval '30 days' where version_id=current_setting('test.plan')::uuid;
select throws_ok($t$select pg_temp.prepare()$t$,'55000','recurring support ended','на дате конца поддержки продление запрещено');
rollback to support;
savepoint zero_discount;
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('recurring-zero-code')::uuid,current_setting('test.org')::uuid,'pro',repeat('a',64),10000,2,1,now()-interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote,state,created_at,settled_at)
values(md5('recurring-initial-benefit')::uuid,md5('recurring-zero-code')::uuid,current_setting('test.org')::uuid,'{}','{}','consumed',now()-interval '3 days',now()-interval '2 days');
select is(pg_temp.prepare()->>'amount_minor','0','продление использует ранее активированную скидку 100%');
select is(pg_temp.prepare()->>'requires_payment','false','нулевой расчёт не требует платежа');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid and state='reserved'),1::bigint,'повтор не резервирует второй льготный период');
rollback to zero_discount;
-- Последний льготный период израсходован: полная цена именно в заказе автопродления.
savepoint exhausted_discount;
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('recurring-exhausted-code')::uuid,current_setting('test.org')::uuid,'pro',repeat('b',64),5000,1,1,now()-interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote,state,created_at,settled_at)
values(md5('recurring-exhausted-benefit')::uuid,md5('recurring-exhausted-code')::uuid,current_setting('test.org')::uuid,'{}','{}','consumed',now()-interval '3 days',now()-interval '2 days');
select set_config('test.full_quote',pg_temp.prepare()::text,true);
select is(current_setting('test.full_quote')::jsonb->>'amount_minor','10000','после последней скидки заказ автопродления на полную исходную цену');
select is(current_setting('test.full_quote')::jsonb->>'plan_version_id',current_setting('test.plan'),'исчерпание скидки сохраняет исходную версию подписки');
select is(pg_temp.prepare(),current_setting('test.full_quote')::jsonb,'повтор полной цены не создаёт новый заказ');
select is((select count(*) from public.billing_recurring_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'после скидки один заказ автопродления');
select is((select count(*) from public.billing_discount_reservations where discount_id=md5('recurring-exhausted-code')::uuid and state='consumed'),1::bigint,'израсходованная льгота не расходуется повторно');
select is((select count(*) from public.billing_discount_reservations where discount_id=md5('recurring-exhausted-code')::uuid and state='reserved'),0::bigint,'исчерпанная скидка не резервируется заново');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'подготовка полной цены не отправляет новый платёж');
rollback to exhausted_discount;
select set_config('test.quote',pg_temp.prepare()::text,true);
select is(current_setting('test.quote')::jsonb->>'base_amount_minor','10000','используется исходная полная цена, а не сумма первого платежа со скидкой');
select is(current_setting('test.quote')::jsonb->>'amount_minor','10000','без активного промокода цена полная');
select is(current_setting('test.quote')::jsonb->>'plan_version_id',current_setting('test.plan'),'сохранена исходная версия');
select is(pg_temp.prepare(),current_setting('test.quote')::jsonb,'повтор возвращает прежний заказ');
select is((select count(*) from public.billing_recurring_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'единственный заказ на период');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'подготовка не создаёт платёж провайдеру');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),1::bigint,'подписка не изменена');
select is(public.revoke_sandbox_recurring_consent(current_setting('test.org')::uuid,md5('recurring-source-consent')::uuid),'revoked','отзыв после подготовки доступен');
select throws_ok($t$select pg_temp.prepare()$t$,'55000','recurring consent unavailable','отозванное согласие закрывает повтор подготовки');
set local role authenticated;
select throws_ok('select * from public.billing_recurring_orders','42501',null,'чужие заказы не читаются напрямую');
reset role;
select ok(not has_function_privilege('service_role','platform_private.prepare_recurring_order(uuid,timestamptz,bigint)','execute'),'публичный RPC подготовки отсутствует');
select * from finish();
rollback;
