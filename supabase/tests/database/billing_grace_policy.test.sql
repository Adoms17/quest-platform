begin;
select no_plan();
create function pg_temp.policy(state text, at_time timestamptz, cancelled boolean default false, paid boolean default false)
returns jsonb language sql as $$ select public.evaluate_billing_lifecycle_policy(state,
'2026-09-01 00:00Z','2026-09-10 00:00Z',cancelled,paid,1,at_time) $$;
select is(pg_temp.policy('active','2026-09-09 23:59:59Z')->>'phase','active','оплаченный период');
select is(pg_temp.policy('active','2026-09-10 00:00Z')->>'phase','grace','начало grace включено');
select is(pg_temp.policy('active','2026-09-14 23:59:59.999999Z')->>'phase','grace','последняя микросекунда grace');
select is(pg_temp.policy('active','2026-09-15 00:00Z')->>'phase','expired','конец 120 часов исключён');
select is(pg_temp.policy('active','2026-09-12 00:00Z',true)->>'phase','grace','отмена сохраняет grace');
select is(pg_temp.policy('expired','2026-09-12 00:00Z',false,true)->>'phase','grace','техническое истечение сохраняет grace');
select is(pg_temp.policy('expired','2026-09-12 00:00Z')->>'phase','expired','недоказанное истечение не выдаёт grace');
select is(pg_temp.policy('trial','2026-09-12 00:00Z')->>'phase','expired','trial без новых условий');
select is(pg_temp.policy('active','2026-08-31 00:00Z')->>'phase','not_started','будущий период');
select is(pg_temp.policy('free','2026-09-12 00:00Z')->>'phase','free','Free не истекает');
select is(pg_temp.policy('transition','2026-09-12 00:00Z')->>'phase','transition','переход сохраняется');
select is(pg_temp.policy('unconfigured','2026-09-12 00:00Z')->>'billing_allows_new_start','false','нет неявного доступа');
select is(pg_temp.policy('active','2026-09-12 00:00Z')->>'billing_allows_resource_increase','true','в grace прежние возможности');
select is(pg_temp.policy('active','2026-09-15 00:00Z')->>'billing_allows_new_start','false','после grace новый старт запрещён политикой');
select is(pg_temp.policy('expired','2026-09-15 00:00Z')->>'billing_blocks_existing_attempt_sync','false','просрочка не блокирует накопленные события');
select is(pg_temp.policy('active','2026-09-12 00:00Z')->>'policy_enforced','false','расчёт не включает enforcement');
select throws_ok($$update public.billing_lifecycle_policy_versions set grace_hours=72$$,'55000',null,'условия неизменяемы');
select throws_ok($$delete from public.billing_lifecycle_policy_versions$$,'55000',null,'версия не удаляется');
select throws_ok($$truncate public.billing_lifecycle_policy_versions cascade$$,'55000',null,'truncate с зависимостями запрещён');
select throws_ok($$select public.evaluate_billing_lifecycle_policy('active',now(),now(),false,false,1,null)$$,'22023',null,'время обязательно');
set local timezone='America/New_York';
select is((public.evaluate_billing_lifecycle_policy('active','2026-10-01Z','2026-10-31Z',false,false,1,'2026-11-01Z')->>'grace_end')::timestamptz,
'2026-11-05 00:00Z'::timestamptz,'120 часов сохраняются при DST');

insert into auth.users(id,email) values(md5('grace-owner')::uuid,'grace-owner@example.test'),(md5('grace-other')::uuid,'grace-other@example.test');
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=md5('grace-owner')::uuid),true);
select set_config('request.jwt.claim.sub',md5('grace-owner')::uuid::text,true);
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
period_start=now()-interval '10 days',period_end=now()-interval '1 day' where organization_id=current_setting('test.org')::uuid;
create function pg_temp.preview() returns jsonb language sql as $$select public.preview_organization_billing_lifecycle(current_setting('test.org')::uuid)$$;
select is(pg_temp.preview()->>'phase','grace','preview до scheduler');
select public.record_organization_subscription_expiration(current_setting('test.org')::uuid,(select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid));
select is(pg_temp.preview()->>'phase','grace','preview после scheduler');
select is(public.get_organization_billing_state(current_setting('test.org')::uuid)->>'status','expired','существующий resolver не менялся');
select is(pg_temp.preview()->>'preview_only','true','явный признак предварительного расчёта');
set local role authenticated;
select is(pg_temp.preview()->>'phase','grace','владелец читает свою политику');
select throws_ok($$select * from public.billing_lifecycle_policy_versions$$,'42501',null,'таблица закрыта');
select throws_ok($$select public.evaluate_billing_lifecycle_policy('active',now(),now(),false,true,1,now())$$,'42501',null,'клиент не задаёт время и происхождение');
select set_config('request.jwt.claim.sub',md5('grace-other')::uuid::text,true);
select throws_ok($$select pg_temp.preview()$$,'42501','billing access denied','чужая организация недоступна');
reset role;
set local role anon;
select throws_ok($$select pg_temp.preview()$$,'42501',null,'анонимный доступ запрещён');
reset role;
select ok((select relrowsecurity from pg_class where oid='public.billing_lifecycle_policy_versions'::regclass),'RLS включён');
select * from finish();
rollback;
