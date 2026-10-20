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
create function pg_temp.prepare() returns jsonb language sql as $$select platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,1)$$;
select set_config('test.prepared',pg_temp.prepare()->>'order_id',true);
create function pg_temp.review() returns jsonb language sql as $$select platform_private.review_recurring_order(current_setting('test.prepared')::uuid)$$;
select set_config('test.attempt',platform_private.begin_recurring_attempt(current_setting('test.prepared')::uuid)::text,true);
select is(public.sandbox_recurring_worker_command(current_setting('test.prepared')::uuid,'apply')->>'state','payment_required','без оплаты доступ не выдаётся');
select platform_private.claim_recurring_dispatch(current_setting('test.prepared')::uuid,(current_setting('test.attempt')::jsonb->>'idempotency_key')::uuid);
select platform_private.record_recurring_result(current_setting('test.prepared')::uuid,jsonb_build_object('paymentId',gen_random_uuid(),'status','succeeded','paid',true,'test',true));
select is(jsonb_array_length(public.list_sandbox_recurring_work('123')),1,'оплаченный неприменённый заказ остаётся в очереди');
select pg_sleep(3);
savepoint changed;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select throws_ok($$select public.sandbox_recurring_worker_command(current_setting('test.prepared')::uuid,'apply')$$,'40001','billing revision conflict','конфликт подписки не перезаписывается оплатой');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'reserved','конфликт сохраняет резерв для разбора');
rollback to changed;
select is(public.sandbox_recurring_worker_command(current_setting('test.prepared')::uuid,'apply')->>'state','applied','оплаченный период применён');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),2::bigint,'одна новая ревизия');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'consumed','резерв использован');
select is(public.sandbox_recurring_worker_command(current_setting('test.prepared')::uuid,'apply')->>'state','applied','повтор успешен');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),2::bigint,'повтор не продлевает снова');
select ok(not has_function_privilege('service_role','platform_private.apply_recurring_period(uuid)','execute'),'выдача пока не открыта шлюзу');
update public.billing_recurring_checks set next_check_at=now()-interval '1 second';
select is(public.list_sandbox_recurring_work('123'),'[]'::jsonb,'выданный период исключён из очереди');
select * from finish();rollback;