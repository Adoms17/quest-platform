begin;
select no_plan();
insert into auth.users(id,email) select md5('monthly-'||n)::uuid,'monthly-'||n||'@example.test' from generate_series(0,2)n;
select set_config('test.monthly_org',(select id::text from public.organizations where personal_owner_id=md5('monthly-0')::uuid),true);
create function pg_temp.monthly() returns jsonb language sql as $$select public.get_monthly_participant_usage(current_setting('test.monthly_org')::uuid)$$;
-- Фикстуры на границах текущего месяца без подмены системных часов.
update public.participant_usage_coverage set started_at=date_trunc('month',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
insert into public.participant_usage_registrations(server_attempt_id,organization_id,participant_profile_id,registered_at,period_start,period_end)
select md5('monthly-record-'||n)::uuid,current_setting('test.monthly_org')::uuid,md5('monthly-profile-'||(n%2))::uuid,
  starts,starts,ends from generate_series(0,2)n cross join lateral (select date_trunc('month',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow' starts,(date_trunc('month',now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow' ends) p;
insert into public.participant_usage_registrations(server_attempt_id,organization_id,participant_profile_id,registered_at,period_start,period_end)
select md5('monthly-next')::uuid,current_setting('test.monthly_org')::uuid,md5('monthly-profile-next')::uuid,
  ends,ends,(ends at time zone 'Europe/Moscow'+interval '1 month') at time zone 'Europe/Moscow'
from (select (date_trunc('month',now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow' ends)p;
select set_config('request.jwt.claim.sub',md5('monthly-0')::uuid::text,true);
set local role authenticated;
select is(pg_temp.monthly()->>'participants','2','повторы профиля не удваиваются; начало включено, следующий месяц исключён');
select is(pg_temp.monthly()->>'is_partial','false','покрытие с начала месяца полное');
select is(pg_temp.monthly()->>'enforcement_enabled','false','участники только учитываются');
select is(pg_temp.monthly()->>'timezone','Europe/Moscow','зона задана явно');
select throws_ok($$update public.participant_usage_coverage set started_at=now()$$,'42501',null,'клиент не меняет покрытие');
reset role;
insert into public.participant_usage_profile_merges(source_profile_id,target_profile_id) values(md5('monthly-profile-0')::uuid,md5('monthly-profile-1')::uuid);
select is(pg_temp.monthly()->>'participants','1','объединение пересчитывает два профиля в одного участника');
select is((select count(*) from public.participant_usage_registrations where organization_id=current_setting('test.monthly_org')::uuid),4::bigint,'исходные факты сохраняются');
insert into public.participant_usage_profile_merges(source_profile_id,target_profile_id) values(md5('monthly-profile-1')::uuid,md5('monthly-profile-chain')::uuid);
select is(public.participant_usage_identity(md5('monthly-profile-0')::uuid),public.participant_usage_identity(md5('monthly-profile-chain')::uuid),'цепочка объединений имеет одну идентичность');
set local role authenticated;
select throws_ok($$insert into public.participant_usage_profile_merges default values$$,'42501',null,'клиент не назначает объединение');
select throws_ok($$select * from public.participant_usage_profile_merges$$,'42501',null,'связи профилей клиенту не раскрываются');
reset role;
update public.participant_usage_coverage set started_at=now();
select is(pg_temp.monthly()->>'is_partial','true','первый неполный месяц обозначен');
select is(pg_temp.monthly()->>'participants','0','нет записей в гарантированном покрытии');
delete from public.participant_usage_coverage;
select ok(pg_temp.monthly()->'participants'='null'::jsonb,'неизвестное покрытие не выдаётся за ноль');
select set_config('request.jwt.claim.sub',md5('monthly-1')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.monthly()$$,'42501','billing access denied','чужая организация закрыта');
select throws_ok($$select public.get_monthly_participant_usage(null)$$,'42501','billing access denied','null закрыт');
reset role;
set local role anon;
select throws_ok($$select pg_temp.monthly()$$,'42501',null,'anon закрыт');
reset role;
select * from finish();
rollback;
