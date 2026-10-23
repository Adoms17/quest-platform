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
select is(public.prepare_due_sandbox_recurring('123')->>'prepared','0','будущий период не готовится');
select pg_sleep(3);
select is(public.prepare_due_sandbox_recurring('456')->>'prepared','0','другой магазин не выбирает подписку');
savepoint revoked;
select public.revoke_sandbox_recurring_consent(current_setting('test.org')::uuid,md5('recurring-source-consent')::uuid);
select is(public.prepare_due_sandbox_recurring('123')->>'prepared','0','отзыв исключён');
rollback to revoked;
select is(public.prepare_due_sandbox_recurring('123')->>'prepared','1','наступивший период подготовлен');
select is(public.prepare_due_sandbox_recurring('123')->>'prepared','0','повтор не создаёт второй заказ');
select is((select count(*) from public.billing_recurring_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'один заказ');
select is((select count(*) from public.billing_recurring_attempts),0::bigint,'подготовка не отправляет платёж');
set local role authenticated;
select throws_ok($$select public.prepare_due_sandbox_recurring('123')$$,'42501',null,'браузер не запускает подготовку');
reset role;
select * from finish();rollback;