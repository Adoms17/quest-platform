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
set local role authenticated;
select set_config('test.same',public.preview_organization_trial_purchase(current_setting('test.org')::uuid,md5('purchase-trial-v2')::uuid)::text,true);
select is(current_setting('test.same')::jsonb->>'transition','after_trial','тот же plan_key даже при новой версии сохраняет trial');
select is(current_setting('test.same')::jsonb->>'paid_starts_at',current_setting('test.same')::jsonb->>'trial_ends_at','платный период начинается на границе trial');
select is(current_setting('test.same')::jsonb->>'trial_remaining_preserved','true','остаток trial сохраняется');
select throws_ok($t$select public.preview_organization_trial_purchase(current_setting('test.org')::uuid,md5('purchase-trial-v1')::uuid)$t$,'22023','current paid tariff required','исходная устаревшая версия не является исключением');
select set_config('test.other',public.preview_organization_trial_purchase(current_setting('test.org')::uuid,md5('purchase-trial-other-plan')::uuid)::text,true);
select is(current_setting('test.other')::jsonb->>'transition','replace_trial_on_payment','другой тариф заменяет trial после оплаты');
select is(current_setting('test.other')::jsonb->>'paid_starts_on_payment','true','старт привязан к подтверждению оплаты');
select is(current_setting('test.other')::jsonb->>'paid_starts_at',null::text,'preview не выдумывает будущий момент оплаты');
select is(current_setting('test.other')::jsonb->>'trial_remaining_preserved','false','остаток при другом тарифе не переносится');
select set_config('request.jwt.claim.sub',md5('purchase-trial-other')::uuid::text,true);
select throws_ok($t$select public.preview_organization_trial_purchase(current_setting('test.org')::uuid,md5('purchase-trial-v2')::uuid)$t$,'42501','billing management denied','чужая организация закрыта');
reset role;
select is((select to_jsonb(s) from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.before')::jsonb,'preview не меняет подписку');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),0::bigint,'preview не создаёт платёж');
select ok(not has_function_privilege('anon','public.preview_organization_trial_purchase(uuid,uuid)','execute'),'анонимный вызов запрещён');
select * from finish();
rollback;
