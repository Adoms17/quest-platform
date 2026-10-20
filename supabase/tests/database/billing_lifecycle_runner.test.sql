begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.run_billing_lifecycle(integer)','execute'),'клиент не запускает обработчик');
select ok(not has_function_privilege('anon','public.run_billing_lifecycle(integer)','execute'),'анонимный запуск запрещён');
select ok(has_function_privilege('service_role','public.run_billing_lifecycle(integer)','execute'),'служебный запуск разрешён');
select ok((select relrowsecurity from pg_class where oid='public.billing_lifecycle_runs'::regclass),'журнал защищён RLS');
select ok(not has_table_privilege('authenticated','public.billing_lifecycle_runs','select'),'журнал закрыт от клиента');
select is((select count(*) from cron.job where jobname='quest-billing-lifecycle' and not active),1::bigint,'расписание подготовлено без включения');
select throws_ok($$select public.run_billing_lifecycle(0)$$,'22023','invalid billing batch size','пачка ограничена');
insert into auth.users(id,email) values(md5('lifecycle-runner-owner')::uuid,'runner@example.test');
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=md5('lifecycle-runner-owner')::uuid),true);
update public.organization_subscriptions set status='active',
 plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
 period_start=now()-interval '2 days',period_end=now()-interval '1 day'
 where organization_id=current_setting('test.org')::uuid;
select lives_ok($$select public.run_billing_lifecycle(100)$$,'обработчик работает без браузера');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'expired','истечение зафиксировано');
select lives_ok($$select public.run_billing_lifecycle(100)$$,'повтор безопасен');
select is((select count(*) from public.billing_expiration_events where organization_id=current_setting('test.org')::uuid),1::bigint,'истечение не дублируется');
select ok(exists(select 1 from public.billing_lifecycle_runs where started_at>=transaction_timestamp()),'результат запуска записан');
select * from finish();
rollback;
