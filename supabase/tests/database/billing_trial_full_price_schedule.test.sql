begin;
select no_plan();
insert into auth.users(id,email) values(md5('purchase-trial-owner')::uuid,'purchase-trial@example.test'),(md5('purchase-trial-other')::uuid,'purchase-trial-other@example.test');
select set_config('request.jwt.claim.sub',md5('purchase-trial-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit)
values(md5('purchase-trial-v1')::uuid,'purchase_trial',1,'Trial 1',5,3),
(md5('purchase-trial-v2')::uuid,'purchase_trial',2,'Trial 2',6,3),
(md5('purchase-trial-other-plan')::uuid,'purchase_other',1,'Other',2,1);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('purchase-trial-v1')::uuid,md5('purchase-trial-v1')::uuid,'purchase_trial',now()-interval '2 days'),
(md5('purchase-trial-other-plan')::uuid,md5('purchase-trial-other-plan')::uuid,'purchase_other',now()-interval '1 day');
select public.request_organization_trial(current_setting('test.org')::uuid,md5('purchase-trial-v1')::uuid,repeat('a',64),md5('purchase-trial-start')::uuid,0);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('purchase-trial-v2')::uuid,md5('purchase-trial-v2')::uuid,'purchase_trial',now()-interval '1 day');
select set_config('test.before',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);

update public.billing_trial_access set ends_at=clock_timestamp()+interval '5 seconds' where organization_id=current_setting('test.org')::uuid;
update public.organization_subscriptions set period_end=(select ends_at from public.billing_trial_access where organization_id=current_setting('test.org')::uuid) where organization_id=current_setting('test.org')::uuid;
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('trial-discount')::uuid,current_setting('test.org')::uuid,'purchase_trial',encode(extensions.digest('TRIAL-CODE','sha256'),'hex'),5000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-offer')::uuid,s.organization_id,md5('purchase-trial-v2')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',s.period_end,
 ((s.period_end at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select throws_ok($t$select platform_private.schedule_confirmed_period_after_trial(current_setting('test.order')::uuid)$t$,'55000','zero trial checkout required','общий исполнитель не обходит неподтверждённую оплату');
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select public.record_sandbox_payment_result_internal(current_setting('test.order')::uuid,md5('trial-money-provider')::uuid,'succeeded',true,true,null);

insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('trial-money-event')::uuid,current_setting('test.order')::uuid,md5('trial-money-provider')::uuid,'payment.succeeded');
select is(public.apply_sandbox_payment_event(md5('trial-money-event')::uuid,jsonb_build_object('paymentId',md5('trial-money-provider')::uuid,'status','succeeded','paid',true,'test',true))->>'fulfillmentState','applied','вход через событие провайдера применяет условия trial');
select set_config('test.result',platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)::text,true);
select is(public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_scheduled','true','сервер различает будущий и начавшийся период');
select is((public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_start')::timestamptz,(current_setting('test.result')::jsonb->>'period_start')::timestamptz,'чтение возвращает фактическое начало');
select is((public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_end')::timestamptz,(current_setting('test.result')::jsonb->>'period_end')::timestamptz,'чтение возвращает фактическое окончание');
select is(current_setting('test.result')::jsonb->>'access_state','scheduled','покупка подтверждена с отложенным доступом');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'trial','до границы сохраняется trial');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','успешная покупка завершает резерв заказа');
select is(platform_private.fulfill_discount_payment(current_setting('test.order')::uuid),current_setting('test.result')::jsonb,'повтор не создаёт ещё один период');
select is((select count(*) from public.billing_trial_paid_periods where organization_id=current_setting('test.org')::uuid),1::bigint,'будущий период один');
select is((select (public.effective_trial_subscription(s,s.period_end-interval '1 microsecond')).status from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),'trial','перед границей действуют trial-условия');
select is((select (public.effective_trial_subscription(s,s.period_end)).plan_version_id from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),md5('purchase-trial-v2')::uuid,'на границе права новой версии доступны без runner');
select is((select (public.effective_trial_subscription(s,s.period_end)).status from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),'active','на границе нет временного Free');
select throws_ok($t$update public.organization_subscriptions set trial_access_id=null,status='free',period_start=null,period_end=null where organization_id=current_setting('test.org')::uuid$t$,'55000','paid trial transition pending','конкурирующее изменение не теряет приобретённый период');
select throws_ok($t$select platform_private.capture_trial_checkout_terms(current_setting('test.org')::uuid,md5('trial-offer')::uuid)$t$,'22023','trial paid period already scheduled','повторная покупка блокируется до резерва скидки');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('duplicate-trial-command')::uuid,'')->>'reason','trial_period_already_paid','новая команда не продаёт оплаченный период повторно');
select is((select count(*) from public.billing_discount_checkouts where organization_id=current_setting('test.org')::uuid),1::bigint,'отказ не создаёт второй заказ');
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end)
select md5('duplicate-unsent-trial')::uuid,organization_id,actor_id,md5('duplicate-unsent-command')::uuid,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end from public.billing_sandbox_orders where id=current_setting('test.order')::uuid;
select throws_ok($t$select public.begin_sandbox_payment_send(md5('duplicate-unsent-trial')::uuid)$t$,'22023','trial paid period already scheduled','ранее подготовленный второй заказ блокируется перед отправкой');
select is((select first_sent_at from public.billing_sandbox_orders where id=md5('duplicate-unsent-trial')::uuid),null::timestamptz,'заблокированный заказ не помечен отправленным');
select pg_sleep(greatest(0,extract(epoch from ((current_setting('test.result')::jsonb->>'period_start')::timestamptz-clock_timestamp())))+0.05);
select is(public.advance_organization_trial(current_setting('test.org')::uuid)->>'outcome','finished','runner завершает trial и применяет приобретённый период');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','в БД сохранён платный статус');
select is((select period_start from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),(current_setting('test.result')::jsonb->>'period_start')::timestamptz,'задержка runner не сдвигает начало');
select is((select trial_access_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),null::uuid,'связь завершённого trial снята');
select is(public.advance_organization_trial(current_setting('test.org')::uuid)->>'changed','false','повтор runner не меняет период');
select is(platform_private.fulfill_discount_payment(current_setting('test.order')::uuid),current_setting('test.result')::jsonb,'повтор покупки после runner возвращает историческое подтверждение');
select ok((select relrowsecurity from pg_class where oid='public.billing_trial_paid_periods'::regclass),'RLS включён');
select ok(not has_table_privilege('authenticated','public.billing_trial_paid_periods','insert'),'клиент не назначает будущий период');
select is(public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_scheduled','false','после границы период не показывается отложенным');
select is((select count(*) from public.billing_discount_reservations where discount_id is not null),0::bigint,'покупка без кода не расходует скидку');
select * from finish();rollback;
