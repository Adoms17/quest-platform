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
values(md5('trial-discount')::uuid,current_setting('test.org')::uuid,'purchase_trial',encode(extensions.digest('TRIAL-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-offer')::uuid,s.organization_id,md5('purchase-trial-v2')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',s.period_end,
 ((s.period_end at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select set_config('test.preview',public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('trial-offer')::uuid,'TRIAL-CODE')::text,true);
select is(current_setting('test.preview')::jsonb#>>'{trial_purchase,transition}','after_trial','preview показывает сохранение trial');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'TRIAL-CODE',current_setting('test.preview')::jsonb-'trial_purchase')->>'reason','quote_changed','без просмотра trial заказ не принимается');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid),0::bigint,'непринятые условия не оставляют резерв');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'TRIAL-CODE',jsonb_set(current_setting('test.preview')::jsonb,'{trial_purchase,generation}','999'))->>'reason','quote_changed','изменение поколения требует нового просмотра');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'TRIAL-CODE',current_setting('test.preview')::jsonb)->>'reserved','true','просмотренные условия принимаются');
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'TRIAL-CODE')::text,true);
select is(current_setting('test.accepted')::jsonb#>>'{trial_purchase,transition}','after_trial','заказ фиксирует сохранение trial для того же тарифа');
select is(current_setting('test.accepted')::jsonb#>>'{trial_purchase,target_plan_version_id}',md5('purchase-trial-v2')::uuid::text,'зафиксирована новая актуальная версия');
select is((current_setting('test.accepted')::jsonb#>>'{trial_purchase,paid_starts_at}')::timestamptz,(current_setting('test.before')::jsonb->>'period_end')::timestamptz,'начало точно на границе trial');
select is((select to_jsonb(s) from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.before')::jsonb,'принятие заказа не прекращает trial');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'TRIAL-CODE'),current_setting('test.accepted')::jsonb,'retry сохраняет снимок условий');
savepoint trial_schedule_check;
select lives_ok($t$select platform_private.fulfill_zero_discount_checkout((current_setting('test.accepted')::jsonb->>'order_id')::uuid)$t$,'исполнитель подтверждает отложенный период');
rollback to trial_schedule_check;
select platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,(current_setting('test.accepted')::jsonb->>'order_id')::uuid);
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-bad-offer')::uuid,s.organization_id,md5('purchase-trial-v2')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',now(),
 ((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select is(public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('trial-bad-offer')::uuid,'TRIAL-CODE')->>'reason','offer_unavailable','тот же тариф нельзя начать раньше окончания trial');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid),1::bigint,'неверная дата не оставляет новый резерв');
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-other-offer')::uuid,s.organization_id,md5('purchase-trial-other-plan')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',now(),
 ((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select set_config('test.other',platform_private.capture_trial_checkout_terms(current_setting('test.org')::uuid,md5('trial-other-offer')::uuid)::text,true);
select is(current_setting('test.other')::jsonb#>>'{trial_purchase,transition}','replace_trial_on_payment','другой тариф требует смены при подтверждении');
select is(current_setting('test.other')::jsonb#>>'{trial_purchase,paid_starts_at}',null::text,'момент подтверждения не выдумывается заранее');
select is(current_setting('test.other')::jsonb#>>'{trial_purchase,trial_remaining_preserved}','false','другой тариф не переносит остаток');
select ok(not has_function_privilege('authenticated','platform_private.capture_trial_checkout_terms(uuid,uuid)','execute'),'внутренняя фиксация не открыта клиенту');
select * from finish();rollback;
