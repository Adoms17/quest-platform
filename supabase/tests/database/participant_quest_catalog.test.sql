begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('93000000-0000-4000-8000-000000000001','catalog-owner@example.test','{"username":"Owner"}'),
('93000000-0000-4000-8000-000000000002','catalog-parent@example.test','{"username":"Parent"}'),
('93000000-0000-4000-8000-000000000003','catalog-other@example.test','{"username":"Other"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select set_config('test.catalog_profile',public.create_dependent_participant_profile('Каталог','child',null)::text,true);
reset role;
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id)
values('93000000-0000-4000-8000-000000000002',current_setting('test.catalog_profile')::uuid);
insert into public.quests(id,creator_id,title,description,is_public,is_open)
select md5('catalog-'||n)::uuid,'93000000-0000-4000-8000-000000000001',
case when n=10000 then 'Дальний маяк' when n=9 then '100%_тест\путь' when n in (1,2) then 'Одинаковый' else 'Квест '||lpad(n::text,5,'0') end,
repeat('Описание ',40),false,true from generate_series(1,10000) n;
insert into public.quest_access_grants(quest_id,user_id,participant_profile_id)
select md5('catalog-'||n)::uuid,'93000000-0000-4000-8000-000000000002',current_setting('test.catalog_profile')::uuid from generate_series(1,10000) n;
create function pg_temp.catalog(s text default '',f text default 'all',c jsonb default null,l integer default 25)
returns jsonb language sql as $$ select public.search_participant_quests(current_setting('test.catalog_profile')::uuid,s,f,c,l) $$;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog()->'items'),25,'25 строк по умолчанию');
select ok((pg_temp.catalog()->>'has_more')::boolean,'есть следующая порция');
select is(jsonb_array_length(pg_temp.catalog(l=>999)->'items'),50,'максимум 50');
select is(jsonb_array_length(pg_temp.catalog(l=>0)->'items'),1,'минимум 1');
select is(jsonb_array_length(pg_temp.catalog('дАЛЬНий')->'items'),1,'поиск вне первой порции без учёта регистра');
select is(jsonb_array_length(pg_temp.catalog('%_')->'items'),1,'LIKE-символы буквально');
select is(jsonb_array_length(pg_temp.catalog(E'\\путь')->'items'),1,'обратная косая черта буквально');
select is(jsonb_array_length(pg_temp.catalog('несуществующее')->'items'),0,'пустой результат');
select is(pg_temp.catalog('несуществующее')->'next_cursor','null'::jsonb,'нет курсора для пустого ответа');
select throws_ok($$select pg_temp.catalog(f=>'bad')$$,'22023','invalid participant search','валидация фильтра');
select throws_ok($$select pg_temp.catalog(repeat('a',201))$$,'22023','invalid participant search','ограничение поиска');
select throws_ok($$select pg_temp.catalog('новый',c=>pg_temp.catalog()->'next_cursor')$$,'22023','invalid participant cursor','курсор связан с поиском');
select throws_ok($$select pg_temp.catalog(f=>'started',c=>pg_temp.catalog()->'next_cursor')$$,'22023','invalid participant cursor','курсор связан с фильтром');
select throws_ok($$select pg_temp.catalog(c=>(pg_temp.catalog()->'next_cursor')||'{"profile_id":"other"}'::jsonb)$$,'22023','invalid participant cursor','курсор связан с профилем');
create temporary table catalog_seen(id uuid primary key);
do $$declare p jsonb; c jsonb; begin
loop
 p:=pg_temp.catalog(c=>c,l=>50);
 insert into catalog_seen select (x->>'id')::uuid from jsonb_array_elements(p->'items') x;
 exit when not (p->>'has_more')::boolean; c:=p->'next_cursor';
end loop;
end$$;
select is((select count(*) from catalog_seen),10000::bigint,'10000 квестов без пропусков и повторов, включая одинаковые названия');
select ok(not exists(select 1 from jsonb_object_keys(pg_temp.catalog()->'items'->0) k where k not in ('id','title','description','start_at','end_at','active_attempt_id','attempt_started_at','deadline_at','completed_tasks','total_tasks','sort_title')),'только разрешённые метаданные, без ответов и контактов');
select ok(length(pg_temp.catalog()->'items'->0->>'description')<=180,'описание ограничено');
reset role;
insert into public.quest_attempts(id,quest_id,user_id,actor_user_id,participant_profile_id,total_tasks,completed_tasks)
select md5('catalog-attempt-'||n)::uuid,md5('catalog-'||n)::uuid,'93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',current_setting('test.catalog_profile')::uuid,8,3 from generate_series(1,3) n;
update public.quest_attempts set finished_at=now() where id=md5('catalog-attempt-2')::uuid;
update public.quest_attempts set deadline_at=now()-interval '1 minute' where id=md5('catalog-attempt-3')::uuid;
update public.quests set is_public=true where id=md5('catalog-1')::uuid;
delete from public.quest_access_grants where quest_id=md5('catalog-1')::uuid;
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog(f=>'started')->'items'),1,'видна активная публичная попытка другого actor, завершённая и просроченная исключены');
select is(pg_temp.catalog(f=>'started')->'items'->0->>'active_attempt_id',md5('catalog-attempt-1')::uuid::text,'исходная серверная попытка');
select is((pg_temp.catalog(f=>'started')->'items'->0->>'completed_tasks')::integer,3,'серверный агрегат прогресса');
reset role;
update public.quests set is_public=false where id=md5('catalog-1')::uuid;
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog(f=>'started')->'items'),0,'приватная попытка без grant не раскрывается');
reset role;
update public.quest_access_grants set granted_at=now()-interval '1 hour', expires_at=now()-interval '1 minute' where quest_id=md5('catalog-10000')::uuid;
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog('Дальний')->'items'),0,'истёкший grant не даёт доступ');
reset role;
update public.quests set is_open=false where id=md5('catalog-9')::uuid;
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog('%_')->'items'),0,'закрытый квест исключён');
reset role;
insert into public.quest_attempts(id,quest_id,user_id,participant_profile_id,started_at,total_tasks)
select md5('catalog-attempt-'||n)::uuid,md5('catalog-'||n)::uuid,'93000000-0000-4000-8000-000000000001',current_setting('test.catalog_profile')::uuid,now()-make_interval(hours=>6-n),8 from generate_series(4,5) n;
set local role authenticated;
select is(pg_temp.catalog(f=>'started',l=>1)->'items'->0->>'id',md5('catalog-5')::uuid::text,'сначала наиболее новая активная попытка');
select is(pg_temp.catalog(f=>'started',l=>1,c=>pg_temp.catalog(f=>'started',l=>1)->'next_cursor')->'items'->0->>'id',md5('catalog-4')::uuid::text,'курсор активных попыток учитывает дату начала');
reset role;
select ok(not has_function_privilege('anon','public.search_participant_quests(uuid,text,text,jsonb,integer)','execute'),'анонимный вызов запрещён');
update public.quests set start_at=now()+interval '1 hour' where id=md5('catalog-8')::uuid;
update public.quests set end_at=now()-interval '1 hour' where id=md5('catalog-7')::uuid;
update public.quest_access_grants set status='revoked', revoked_at=now() where quest_id=md5('catalog-6')::uuid;
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog('00008')->'items'),0,'будущее расписание исключено');
select is(jsonb_array_length(pg_temp.catalog('00007')->'items'),0,'закончившееся расписание исключено');
select is(jsonb_array_length(pg_temp.catalog('00006')->'items'),0,'отозванный grant исключён');
reset role;
select ok((select relrowsecurity from pg_class where oid='public.quests'::regclass),'RLS квестов сохранена');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select pg_temp.catalog()$$,'42501','participant catalog access denied','чужой профиль недоступен');
reset role;
update public.participant_supervisions set status='revoked' where supervisor_user_id='93000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.catalog()$$,'42501','participant catalog access denied','отзыв контроля применяется сразу');
select * from finish();
rollback;
