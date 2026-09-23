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
select is(current_setting('test.attempt')::jsonb->>'state','prepared','первая попытка зафиксирована');
select is(platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)->>'state','reconciliation_required','повтор требует сверки');
select is(platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)->>'idempotency_key',current_setting('test.attempt')::jsonb->>'idempotency_key','ключ повторной попытки сохранён');
select is((select count(*) from public.billing_recurring_attempts where order_id=current_setting('test.prepared')::uuid),1::bigint,'одна попытка');
select is((select amount_minor from public.billing_recurring_attempts where order_id=current_setting('test.prepared')::uuid),10000::bigint,'сумма зафиксирована из расчёта');
select is(pg_temp.review()->>'state','reconciliation_required','проверка учитывает уже зафиксированную попытку');
select public.revoke_sandbox_recurring_consent(current_setting('test.org')::uuid,md5('recurring-source-consent')::uuid);
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'reserved','отзыв после фиксации не освобождает неопределённую попытку');
select is(platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)->>'state','reconciliation_required','отзыв не создаёт новый платёж при повторе');
select throws_ok('update public.billing_recurring_attempts set amount_minor=1','55000',null,'снимок попытки неизменяем');
set local role authenticated;
select throws_ok('select * from public.billing_recurring_attempts','42501',null,'клиент не читает способ оплаты');
reset role;
select ok(not has_function_privilege('service_role','platform_private.begin_recurring_attempt(uuid)','execute'),'публичный RPC отправки ещё закрыт');
select * from finish();rollback;