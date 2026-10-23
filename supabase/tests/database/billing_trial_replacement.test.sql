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
values(md5('replacement-code')::uuid,current_setting('test.org')::uuid,'purchase_other',encode(extensions.digest('REPLACE','sha256'),'hex'),10000,1,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('replacement-offer')::uuid,s.organization_id,md5('purchase-trial-other-plan')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',now(),
 ((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('replacement-offer')::uuid,md5('replacement-command')::uuid,'REPLACE')::text,true);
select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'trial','принятие заказа оставляет trial');
savepoint before_changed_trial;
update public.billing_trial_access set generation=generation+1 where organization_id=current_setting('test.org')::uuid;
select throws_ok($t$select platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid)$t$,'40001','trial checkout context changed','изменённый trial требует пересогласования');
select is((select state from public.billing_discount_checkout_states where order_id=current_setting('test.order')::uuid),'ready','конфликт откатывает начало исполнения');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','конфликт не расходует скидку');
rollback to before_changed_trial;
select set_config('test.confirm_before',clock_timestamp()::text,true);
select set_config('test.result',platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid)::text,true);
select is(current_setting('test.result')::jsonb->>'status','completed','покупка другого тарифа исполнена');
select is((select plan_version_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),md5('purchase-trial-other-plan')::uuid,'выдан выбранный другой тариф');
select ok((current_setting('test.result')::jsonb->>'period_start')::timestamptz>=current_setting('test.confirm_before')::timestamptz,'период начинается при подтверждении');
select is((current_setting('test.result')::jsonb->>'period_end')::timestamptz,(((current_setting('test.result')::jsonb->>'period_start')::timestamptz at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow','новый период длится полный календарный месяц');
select is(current_setting('test.result')::jsonb->>'trial_remaining_preserved','false','остаток trial не переносится');
select is((select state from public.billing_trial_access where organization_id=current_setting('test.org')::uuid),'finished','trial завершён');
select is((select trial_access_id from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),null::uuid,'связь активного trial снята');
select is(platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid),current_setting('test.result')::jsonb,'retry не выдаёт новый период');
select is((select count(*) from public.billing_trial_transitions where access_id=(current_setting('test.before')::jsonb->>'trial_access_id')::uuid and kind='finished'),1::bigint,'завершение trial записано один раз');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'consumed','скидка израсходована');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),0::bigint,'денежный платёж не создаётся');
select ok(not has_function_privilege('authenticated','platform_private.confirm_trial_checkout_replacement(uuid)','execute'),'клиент не завершает trial в обход checkout');
select * from finish();rollback;
