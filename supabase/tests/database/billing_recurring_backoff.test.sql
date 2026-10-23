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
select set_config('test.prepared',pg_temp.prepare()->>'order_id',true);
create function pg_temp.review() returns jsonb language sql as $$select platform_private.review_recurring_order(current_setting('test.prepared')::uuid)$$;
select set_config('test.attempt',platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)::text,true);
select is(jsonb_array_length(public.list_sandbox_recurring_work('123')),1,'первая проверка выбрана');
select is(public.list_sandbox_recurring_work('123'),'[]'::jsonb,'немедленный повтор не занимает очередь');
select is((select check_count from public.billing_recurring_checks where order_id=current_setting('test.prepared')::uuid),1,'пропуск не увеличивает счётчик');
select ok((select next_check_at-last_started_at=interval '5 minutes' from public.billing_recurring_checks where order_id=current_setting('test.prepared')::uuid),'начальная пауза пять минут');
update public.billing_recurring_checks set next_check_at=now()-interval '1 second';
select is(jsonb_array_length(public.list_sandbox_recurring_work('123')),1,'после паузы проверка доступна');
select ok((select next_check_at-last_started_at=interval '10 minutes' from public.billing_recurring_checks where order_id=current_setting('test.prepared')::uuid),'повтор увеличивает паузу');
update public.billing_recurring_checks set next_check_at=now()-interval '1 second',check_count=100;
select public.list_sandbox_recurring_work('123');
select ok((select next_check_at-last_started_at=interval '60 minutes' from public.billing_recurring_checks where order_id=current_setting('test.prepared')::uuid),'пауза ограничена часом, сверка не прекращается');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'reserved','пауза не освобождает резерв');
set local role authenticated;
select throws_ok('select * from public.billing_recurring_checks','42501',null,'служебные проверки закрыты клиенту');
reset role;
select * from finish();rollback;