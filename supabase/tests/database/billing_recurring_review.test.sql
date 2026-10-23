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
select is(pg_temp.review()->>'state','ready','неизменённый заказ готов к следующему серверному шагу');
select is(pg_temp.review()->>'requires_payment','true','полная цена требует оплаты');
savepoint cancel_subscription;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.review()->>'reason','subscription_changed','отмена продления обнаружена после подготовки');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'released','неотправленный резерв освобождён');
select is(pg_temp.review()->>'state','cancelled','повтор проверки не возобновляет отменённый заказ');
select is((select count(*) from public.billing_recurring_cancellations where order_id=current_setting('test.prepared')::uuid),1::bigint,'одна аудиторская запись отмены');
rollback to cancel_subscription;
savepoint support_end;
update public.billing_tariff_timeline set support_ends_at=current_setting('test.ends')::timestamptz,support_notice_at=current_setting('test.ends')::timestamptz-interval '30 days' where version_id=current_setting('test.plan')::uuid;
select is(pg_temp.review()->>'reason','support_ended','новый срок поддержки блокирует подготовленный заказ');
rollback to support_end;
savepoint revoke;
select public.revoke_sandbox_recurring_consent(current_setting('test.org')::uuid,md5('recurring-source-consent')::uuid);
select is(pg_temp.review()->>'reason','consent_revoked','отзыв обнаружен и зафиксирован');
rollback to revoke;
savepoint scope;
delete from public.billing_sandbox_application_scope where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.review()->>'reason','sandbox_disabled','выключение области блокирует заказ');
rollback to scope;
savepoint in_flight;
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,first_sent_at,state)
values(current_setting('test.prepared')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,1,10000,'RUB','123','https://stage.qvesta.ru',current_setting('test.ends')::timestamptz,current_setting('test.ends')::timestamptz+interval '1 month',clock_timestamp(),'sending');
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.review()->>'state','reconciliation_required','начатый платёж передаётся на сверку');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'reserved','резерв начатого платежа не освобождён');
select is((select count(*) from public.billing_recurring_cancellations where order_id=current_setting('test.prepared')::uuid),0::bigint,'не заявлена отмена начатого платежа');
rollback to in_flight;
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),1::bigint,'проверка не изменяет подписку');
set local role authenticated;
select throws_ok('select * from public.billing_recurring_cancellations','42501',null,'прямое чтение журнала закрыто');
reset role;
select ok(not has_function_privilege('service_role','platform_private.review_recurring_order(uuid)','execute'),'отдельный RPC проверки недоступен');
select ok((select relrowsecurity from pg_class where oid='public.billing_recurring_cancellations'::regclass),'RLS журнала включён');
select * from finish();
rollback;