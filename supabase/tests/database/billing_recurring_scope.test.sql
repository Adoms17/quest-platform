begin;
select no_plan();
-- Только синтетический серверный снимок уже оплаченного периода и подтверждённого согласия.
insert into auth.users(id,email) values(md5('recurring-order-owner')::uuid,'recurring-order-owner@example.test');
select set_config('request.jwt.claim.sub',md5('recurring-order-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select set_config('test.ends',(now()+interval '3 seconds')::text,true);
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,gen_random_uuid(),0,current_setting('test.plan')::uuid,((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz);
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('recurring-source-offer')::uuid,current_setting('test.org')::uuid,current_setting('test.plan')::uuid,0,10000,'123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,now()-interval '1 day',1);
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,state,offer_id)
values(md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,0,5000,'RUB','123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,'finished',md5('recurring-source-offer')::uuid);
insert into public.billing_recurring_consents(id,order_id,organization_id,actor_id,terms_version)
values(md5('recurring-source-consent')::uuid,md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),'sandbox-recurring-v2');
insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
values(md5('recurring-source-consent')::uuid,'synthetic-method',gen_random_uuid());
select set_config('test.first',current_setting('test.org'),true);
-- Только синтетический серверный снимок уже оплаченного периода и подтверждённого согласия.
insert into auth.users(id,email) values(md5('second-recurring-order-owner')::uuid,'second-recurring-order-owner@example.test');
select set_config('request.jwt.claim.sub',md5('second-recurring-order-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select set_config('test.ends',(now()+interval '3 seconds')::text,true);
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,gen_random_uuid(),0,current_setting('test.plan')::uuid,((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz);
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('second-recurring-source-offer')::uuid,current_setting('test.org')::uuid,current_setting('test.plan')::uuid,0,10000,'123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,now()-interval '1 day',1);
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,state,offer_id)
values(md5('second-recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,0,5000,'RUB','123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,'finished',md5('second-recurring-source-offer')::uuid);
insert into public.billing_recurring_consents(id,order_id,organization_id,actor_id,terms_version)
values(md5('second-recurring-source-consent')::uuid,md5('second-recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),'sandbox-recurring-v2');
insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
values(md5('second-recurring-source-consent')::uuid,'synthetic-method',gen_random_uuid());
select pg_sleep(3);
select is(public.prepare_scoped_sandbox_recurring('123',null)->>'prepared','0','null не расширяет область');
select is(public.prepare_scoped_sandbox_recurring('123',current_setting('test.first')::uuid)->>'prepared','1','готовится только выбранная организация');
select is((select count(*) from public.billing_recurring_orders where organization_id=current_setting('test.org')::uuid),0::bigint,'другая организация не получает заказ');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid and state='reserved'),0::bigint,'другая организация не получает резерв');
select is(public.prepare_scoped_sandbox_recurring('123',current_setting('test.org')::uuid)->>'prepared','1','отдельно подготовлен второй заказ для проверки очереди');
select platform_private.begin_recurring_attempt(id) from public.billing_recurring_orders where organization_id in (current_setting('test.org')::uuid,current_setting('test.first')::uuid);
select is(jsonb_array_length(public.list_scoped_sandbox_recurring_work('123',current_setting('test.first')::uuid)),1,'выбрана одна организация');
select is((select count(*) from public.billing_recurring_checks c join public.billing_recurring_orders r on r.id=c.order_id where r.organization_id=current_setting('test.org')::uuid),0::bigint,'расписание сверки другой организации не изменено');
select is(public.list_scoped_sandbox_recurring_work('123',null),'[]'::jsonb,'null не захватывает очередь');
set local role authenticated;
select throws_ok($$select public.prepare_scoped_sandbox_recurring('123',null)$$,'42501',null,'браузеру запрещена подготовка');
select throws_ok($$select public.list_scoped_sandbox_recurring_work('123',null)$$,'42501',null,'браузеру запрещена очередь');
reset role;
select * from finish();rollback;
