begin;
select no_plan();

select is((select trial_duration_days from public.billing_plan_versions where plan_key='pro' and version=1),14,'trial по умолчанию 14 суток');
select ok((select relrowsecurity from pg_class where oid='public.billing_trial_usage'::regclass),'история защищена RLS');
select lives_ok($$insert into public.billing_plan_versions(plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days)
 values('pro',902,'Pro test',5,3,21)$$,'новая версия задаёт свою длительность');
select throws_ok($$insert into public.billing_plan_versions(plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days)
 values('pro',903,'Pro test',5,3,0)$$,'23514',null,'нулевой срок запрещён');
select throws_ok($$update public.billing_plan_versions set trial_duration_days=21 where plan_key='pro' and version=1$$,
 '55000','billing plan versions are immutable','длительность старой версии не переписывается');

-- Фиктивные идентификаторы: история не требует живого аккаунта или организации.
create function pg_temp.record_trial(a integer,o integer,d integer,p text default 'pro',v integer default 1,c integer default 1)
returns void language sql as $$
 insert into public.billing_trial_usage(actor_id,organization_id,command_id,device_key_hash,plan_version_id,plan_key,trial_duration_days,consumed_at)
 values(md5('actor'||a)::uuid,md5('org'||o)::uuid,md5('command'||c)::uuid,lpad(d::text,64,'0'),
 (select id from public.billing_plan_versions where plan_key=p and version=v),'forged',999,'2000-01-01');
$$;
select lives_ok($$select pg_temp.record_trial(1,1,1)$$,'первая запись trial');
select is((select plan_key from public.billing_trial_usage),'pro','сервер копирует ключ тарифа');
select is((select trial_duration_days from public.billing_trial_usage),14,'сервер копирует длительность тарифа');
select ok((select consumed_at>=transaction_timestamp() from public.billing_trial_usage),'время задаёт сервер');
select throws_ok($$select pg_temp.record_trial(1,2,2,'pro',902,2)$$,'23505',null,'новая версия и организация не обходят историю аккаунта');
select throws_ok($$select pg_temp.record_trial(2,1,2,'pro',902)$$,'23505',null,'другой аккаунт не обходит историю организации');
select throws_ok($$select pg_temp.record_trial(2,2,1)$$,'23505',null,'новый аккаунт и организация не обходят известный браузер');
select throws_ok($$select pg_temp.record_trial(1,1,1)$$,'23505',null,'повтор записи не создаёт второе использование');
select throws_ok($$select pg_temp.record_trial(1,1,1,'business')$$,'23505',null,'одна команда не выдаёт два разных trial');
select lives_ok($$select pg_temp.record_trial(1,1,1,'business',1,2)$$,'другой тариф можно попробовать один раз');
select lives_ok($$select pg_temp.record_trial(2,2,2,'pro',902)$$,'другая команда получает срок новой версии');
select is((select trial_duration_days from public.billing_trial_usage where actor_id=md5('actor2')::uuid),21,'зафиксирован срок новой версии');
select throws_ok($$select pg_temp.record_trial(3,3,3,'free')$$,'22023','trial requires a paid plan','Free не имеет trial');
select throws_ok($$insert into public.billing_trial_usage(actor_id,organization_id,command_id,device_key_hash,plan_version_id)
 values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'raw-device',(select id from public.billing_plan_versions where plan_key='pro' and version=1))$$,
 '23514',null,'сырые метки не принимаются вместо хеша');
select throws_ok($$update public.billing_trial_usage set actor_id=gen_random_uuid()$$,'55000','trial usage is immutable','историю нельзя переназначить');
select throws_ok($$delete from public.billing_trial_usage$$,'55000','trial usage is immutable','историю нельзя удалить для повторного trial');
select throws_ok($$truncate public.billing_trial_usage cascade$$,'55000','trial usage is immutable','truncate не сбрасывает историю');
select is((select count(*) from pg_constraint where conrelid='public.billing_trial_usage'::regclass and contype='f'),1::bigint,'только FK к версии: удаление аккаунта или организации не стирает историю');

set local role authenticated;
select throws_ok($$select * from public.billing_trial_usage$$,'42501',null,'клиент не читает чужую историю и метки');
select throws_ok($$insert into public.billing_trial_usage default values$$,'42501',null,'клиент не отмечает использование напрямую');
select throws_ok($$update public.billing_trial_usage set plan_key='business'$$,'42501',null,'клиент не меняет историю');
select throws_ok($$delete from public.billing_trial_usage$$,'42501',null,'клиент не сбрасывает trial');
reset role;
set local role anon;
select throws_ok($$select * from public.billing_trial_usage$$,'42501',null,'аноним не читает историю');
reset role;
set local role service_role;
select throws_ok($$insert into public.billing_trial_usage default values$$,'42501',null,'service role не обходит будущую атомарную команду прямой записью');
reset role;

select * from finish();
rollback;
