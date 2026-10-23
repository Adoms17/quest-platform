begin;
select no_plan();
insert into auth.users(id,email) values(md5('trial-timeline-owner')::uuid,'trial-timeline@example.test');
select set_config('request.jwt.claim.sub',md5('trial-timeline-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit)
values(md5('trial-current')::uuid,'trial_timeline',1,'Current',5,3),
(md5('trial-future')::uuid,'trial_timeline',2,'Future',6,3),
(md5('free-at-end')::uuid,'free',90001,'Free at end',2,2),
(md5('free-later')::uuid,'free',90002,'Free later',3,3);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('trial-current')::uuid,md5('trial-current')::uuid,'trial_timeline',now()-interval '1 day'),
(md5('trial-future')::uuid,md5('trial-future')::uuid,'trial_timeline',now()+interval '1 day'),
(md5('free-at-end')::uuid,md5('free-at-end')::uuid,'free',now()+interval '2 days'),
(md5('free-later')::uuid,md5('free-later')::uuid,'free',now()+interval '20 days');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_organization_free_access_controls(current_setting('test.org')::uuid,repeat('f',64))->'targets')t where t->>'id'=md5('trial-current')::uuid::text),'актуальная версия в списке trial');
select ok(not exists(select 1 from jsonb_array_elements(public.get_organization_free_access_controls(current_setting('test.org')::uuid,repeat('f',64))->'targets')t where t->>'id'=md5('trial-future')::uuid::text),'будущая версия не подменяет текущую по номеру');
select throws_ok($t$select public.request_organization_trial(current_setting('test.org')::uuid,md5('trial-future')::uuid,repeat('f',64),md5('future-trial')::uuid,0)$t$,'22023','tariff version no longer current','прямой запрос будущего trial запрещён');
select set_config('test.receipt',public.request_organization_trial(current_setting('test.org')::uuid,md5('trial-current')::uuid,repeat('f',64),md5('current-trial')::uuid,0)::text,true);
reset role;
select is((select public.effective_trial_subscription(s,s.period_end-interval '1 microsecond')).plan_version_id,md5('trial-current')::uuid,'до границы сохраняются выданные условия') from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid;
select is((public.effective_trial_subscription(s,s.period_end)).plan_version_id,md5('free-at-end')::uuid,'на границе выбирается новая Free вместо сохранённой старой') from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid;
select is((public.effective_trial_subscription(s,s.period_end+interval '30 days')).plan_version_id,md5('free-at-end')::uuid,'поздний runner не меняет версию перехода') from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid;
select is((select receipt from public.billing_trial_access where organization_id=current_setting('test.org')::uuid),current_setting('test.receipt')::jsonb,'исторический receipt не переписан');
select is((select count(*) from public.billing_trial_usage where organization_id=current_setting('test.org')::uuid),1::bigint,'отклонённый запрос не расходует trial');
set local role authenticated;
select is(public.request_organization_trial(current_setting('test.org')::uuid,md5('trial-current')::uuid,repeat('f',64),md5('current-trial')::uuid,0),current_setting('test.receipt')::jsonb,'retry сохраняет доступ');
reset role;
-- Промокоды теперь скидки при покупке; их периоды проверяются billing_discount_*.
select is(to_regprocedure('public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid)'),null::regprocedure,'устаревшая выдача промодоступа удалена');
select * from finish();rollback;
