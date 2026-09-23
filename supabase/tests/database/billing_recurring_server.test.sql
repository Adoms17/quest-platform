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
select is(platform_private.read_recurring_attempt(current_setting('test.prepared')::uuid)->>'providerMethodId','synthetic-method','сервер читает исходный метод');
select ok(platform_private.authorize_recurring_send(current_setting('test.prepared')::uuid,(current_setting('test.attempt')::jsonb->>'idempotency_key')::uuid),'guard разрешает неизменённую попытку');
select ok(not platform_private.authorize_recurring_send(current_setting('test.prepared')::uuid,gen_random_uuid()),'другой ключ отклонён');
savepoint revoked;
select public.revoke_sandbox_recurring_consent(current_setting('test.org')::uuid,md5('recurring-source-consent')::uuid);
select ok(not platform_private.authorize_recurring_send(current_setting('test.prepared')::uuid,(current_setting('test.attempt')::jsonb->>'idempotency_key')::uuid),'отзыв запрещает POST');
rollback to revoked;
create function pg_temp.result(status text, id uuid default md5('recurring-result')::uuid) returns jsonb language sql as $$
select platform_private.record_recurring_result(current_setting('test.prepared')::uuid,jsonb_build_object('paymentId',id,'status',status,'paid',status='succeeded','test',true))$$;
select is(pg_temp.result('pending')->>'status','pending','ожидание сохранено');
select ok(not platform_private.authorize_recurring_send(current_setting('test.prepared')::uuid,(current_setting('test.attempt')::jsonb->>'idempotency_key')::uuid),'известный платёж требует GET вместо POST');
select is(pg_temp.result('succeeded')->>'status','succeeded','успех сохранён');
select is(pg_temp.result('pending')->>'status','succeeded','поздний pending не отменяет успех');
select is(pg_temp.result('succeeded')->>'requiresReview','false','повтор успеха безопасен');
select is(pg_temp.result('succeeded',gen_random_uuid())->>'requiresReview','true','подмена платежа требует проверки');
select is(platform_private.read_recurring_attempt(current_setting('test.prepared')::uuid)->>'providerPaymentId',md5('recurring-result')::uuid::text,'исходный платёж не заменён');
select is(pg_temp.result('canceled')->>'status','succeeded','конфликт отмены не затирает успех');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),1::bigint,'запись результата не выдаёт доступ');
select ok(not has_function_privilege('service_role','platform_private.record_recurring_result(uuid,jsonb)','execute'),'RPC записи пока закрыт');
set local role authenticated;
select throws_ok('select * from public.billing_recurring_results','42501',null,'клиент не читает результаты напрямую');
reset role;
select * from finish();rollback;