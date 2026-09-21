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

insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('replacement-code')::uuid,current_setting('test.org')::uuid,'purchase_other',encode(extensions.digest('REPLACE','sha256'),'hex'),5000,1,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('replacement-offer')::uuid,s.organization_id,md5('purchase-trial-other-plan')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',now(),
 ((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select throws_ok($t$select public.accept_sandbox_checkout_offer(current_setting('test.org')::uuid,md5('replacement-offer')::uuid,md5('legacy-trial-command')::uuid)$t$,'55000','trial requires reviewed checkout','старый клиент не обходит согласование trial');
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('replacement-offer')::uuid,md5('replacement-command')::uuid,'')::text,true);
select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select is(public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_starts_on_confirmation','true','до оплаты точные даты не обещаются');
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select throws_ok($t$select platform_private.confirm_trial_checkout_replacement(current_setting('test.order')::uuid)$t$,'55000','zero trial checkout required','общий исполнитель не обходит неподтверждённую оплату');
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select public.record_sandbox_payment_result_internal(current_setting('test.order')::uuid,md5('trial-money-provider')::uuid,'succeeded',true,true,null);

select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'trial','принятие заказа оставляет trial');
savepoint before_changed_trial;
update public.billing_trial_access set generation=generation+1 where organization_id=current_setting('test.org')::uuid;
select throws_ok($t$select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)$t$,'40001','trial checkout context changed','изменённый trial требует пересогласования');
select is((select state from public.billing_discount_checkout_states where order_id=current_setting('test.order')::uuid),'executing','конфликт сохраняет начатый денежный заказ для сверки');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','конфликт не расходует скидку');
rollback to before_changed_trial;
select set_config('test.confirm_before',clock_timestamp()::text,true);
insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('trial-money-event')::uuid,current_setting('test.order')::uuid,md5('trial-money-provider')::uuid,'payment.succeeded');
select is(public.apply_sandbox_payment_event(md5('trial-money-event')::uuid,jsonb_build_object('paymentId',md5('trial-money-provider')::uuid,'status','succeeded','paid',true,'test',true))->>'fulfillmentState','applied','вход через событие провайдера применяет условия trial');
select set_config('test.result',platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)::text,true);
select is(public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_scheduled','false','сервер различает будущий и начавшийся период');
select is((public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_start')::timestamptz,(current_setting('test.result')::jsonb->>'period_start')::timestamptz,'чтение возвращает фактическое начало');
select is((public.get_sandbox_order_offer(current_setting('test.org')::uuid,current_setting('test.order')::uuid)->>'period_end')::timestamptz,(current_setting('test.result')::jsonb->>'period_end')::timestamptz,'чтение возвращает фактическое окончание');
select is(current_setting('test.result')::jsonb->>'status','completed','покупка другого тарифа исполнена');
select is((select plan_version_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),md5('purchase-trial-other-plan')::uuid,'выдан выбранный другой тариф');
select ok((current_setting('test.result')::jsonb->>'period_start')::timestamptz>=current_setting('test.confirm_before')::timestamptz,'период начинается при подтверждении');
select is((current_setting('test.result')::jsonb->>'period_end')::timestamptz,(((current_setting('test.result')::jsonb->>'period_start')::timestamptz at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow','новый период длится полный календарный месяц');
select is(current_setting('test.result')::jsonb->>'trial_remaining_preserved','false','остаток trial не переносится');
select is((select state from public.billing_trial_access where organization_id=current_setting('test.org')::uuid),'finished','trial завершён');
select is((select trial_access_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),null::uuid,'связь активного trial снята');
select is(platform_private.fulfill_discount_payment(current_setting('test.order')::uuid),current_setting('test.result')::jsonb,'retry не выдаёт новый период');
select is((select count(*) from public.billing_trial_transitions where access_id=(current_setting('test.before')::jsonb->>'trial_access_id')::uuid and kind='finished'),1::bigint,'завершение trial записано один раз');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','скидка израсходована');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'выдача использует один денежный заказ');
select ok(not has_function_privilege('authenticated','platform_private.confirm_trial_checkout_replacement(uuid)','execute'),'клиент не завершает trial в обход checkout');
select is((select count(*) from public.billing_discount_reservations where discount_id is not null),0::bigint,'покупка без кода не расходует скидку');
select * from finish();rollback;
