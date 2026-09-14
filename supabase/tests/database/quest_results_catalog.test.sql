begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('1c000000-0000-4000-8000-000000000001','results-owner@example.test','{"username":"Owner"}'),
 ('1c000000-0000-4000-8000-000000000002','results-player@example.test','{"username":"Executor"}'),
 ('1c000000-0000-4000-8000-000000000003','results-host@example.test','{"username":"Host"}');
insert into public.quests(id,creator_id,organization_id,title,is_public)
select '2c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001',id,'Results quest',false
from public.organizations where personal_owner_id='1c000000-0000-4000-8000-000000000001';
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id)
select md5('results-profile-'||n)::uuid,case when n=61 then 'Дальний %_ участник' else 'Участник '||n end,
'dependent','child','1c000000-0000-4000-8000-000000000002' from generate_series(1,61)n;
insert into public.quest_attempts(id,quest_id,user_id,actor_user_id,participant_profile_id,started_at,finished_at,total_tasks,completed_tasks,percent_success)
select md5('results-attempt-'||n)::uuid,'2c000000-0000-4000-8000-000000000001',
'1c000000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-000000000002',md5('results-profile-'||n)::uuid,
case when n=61 then null else '2026-09-01'::timestamptz end,
case when n%2=0 then '2026-09-02'::timestamptz else null end,2,1,50 from generate_series(1,61)n;
create function pg_temp.results(s text default '',f text default 'all',c jsonb default null,l integer default 25)
returns jsonb language sql as $$select public.search_quest_results('2c000000-0000-4000-8000-000000000001',s,f,c,l)$$;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.results()->'items'),25,'по умолчанию 25 результатов');
select is(jsonb_array_length(pg_temp.results(l=>999)->'items'),50,'верхний предел 50');
select is(jsonb_array_length(pg_temp.results(l=>0)->'items'),1,'минимум одна запись');
select is(pg_temp.results('дАЛЬНий')->'items'->0->>'participant_display_name','Дальний %_ участник','поиск по всему набору без учёта регистра');
select is(jsonb_array_length(pg_temp.results('%_')->'items'),1,'спецсимволы поиска буквальные');
select is(jsonb_array_length(pg_temp.results('Executor')->'items'),25,'поиск по имени аккаунта');
select is(jsonb_array_length(pg_temp.results(f=>'finished',l=>50)->'items'),30,'только завершённые');
select is(jsonb_array_length(pg_temp.results(f=>'unfinished',l=>50)->'items'),31,'только незавершённые');
select is(pg_temp.results()->'items'->0->>'percent_success','50','серверный процент возвращается без пересчёта');
select ok(not (pg_temp.results()->'items'->0 ?| array['task_attempts','answers','email','user_id','actor_user_id']),'нет ответов, контактов и деталей заданий');
create temporary table result_pages as select pg_temp.results() payload;
insert into result_pages select pg_temp.results(c=>payload->'next_cursor') from result_pages limit 1;
insert into result_pages select pg_temp.results(c=>payload->'next_cursor') from result_pages offset 1 limit 1;
select is((select count(distinct x->>'id') from result_pages,jsonb_array_elements(payload->'items')x),61::bigint,'одинаковые даты без пропусков');
select is((select count(*) from result_pages,jsonb_array_elements(payload->'items')x),61::bigint,'без дублей');
select is((select payload->'items'->10->>'participant_display_name' from result_pages offset 2 limit 1),'Дальний %_ участник','NULL-дата в конце');
select throws_ok($$select pg_temp.results(c=>'{}')$$,'22023','invalid results cursor','неполный курсор отклонён');
select throws_ok($$select pg_temp.results('другой',c=>pg_temp.results()->'next_cursor')$$,'22023','invalid results cursor','курсор привязан к поиску');
select throws_ok($$select pg_temp.results(f=>'finished',c=>pg_temp.results()->'next_cursor')$$,'22023','invalid results cursor','курсор привязан к фильтру');
select throws_ok($$select pg_temp.results(c=>jsonb_set(pg_temp.results()->'next_cursor','{actor_id}','"other"'))$$,'22023','invalid results cursor','курсор привязан к аккаунту');
select throws_ok($$select pg_temp.results(c=>jsonb_set(pg_temp.results()->'next_cursor','{quest_id}','"other"'))$$,'22023','invalid results cursor','курсор привязан к квесту');
select throws_ok($$select pg_temp.results(f=>'unknown')$$,'22023','invalid results filter','неизвестный фильтр отклонён');
select throws_ok($$select pg_temp.results(repeat('x',201))$$,'22023','invalid results filter','длина поиска ограничена');
reset role;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.results()$$,'42501','quest statistics access denied','участие не даёт статистику всего квеста');
reset role;
insert into public.organization_memberships(organization_id,user_id,status)
select organization_id,'1c000000-0000-4000-8000-000000000003','active' from public.quests where id='2c000000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id)
select m.id,r.id from public.organization_memberships m cross join public.roles r
where m.organization_id=(select organization_id from public.quests where id='2c000000-0000-4000-8000-000000000001') and m.user_id='1c000000-0000-4000-8000-000000000003' and r.key='host';
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.results()->'items'),25,'ведущий с quest_stats.read видит результаты');
reset role;
update public.organization_memberships set status='revoked' where user_id='1c000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select pg_temp.results()$$,'42501','quest statistics access denied','после отзыва роли чтение закрыто');
reset role;
select ok(not has_function_privilege('anon','public.search_quest_results(uuid,text,text,jsonb,integer)','execute'),'anon запрещён');
select * from finish();
rollback;
