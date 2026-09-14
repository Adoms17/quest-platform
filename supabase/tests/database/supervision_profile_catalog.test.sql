begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('98000000-0000-4000-8000-000000000001','creator@example.test','{"username":"Creator"}'),
('98000000-0000-4000-8000-000000000002','other@example.test','{"username":"Other"}');
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id)
select ('98000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'Профиль '||lpad(n::text,2,'0'),'dependent','child','98000000-0000-4000-8000-000000000001' from generate_series(1,60) n;
insert into public.participant_supervisions(participant_profile_id,supervisor_user_id,status)
select id,'98000000-0000-4000-8000-000000000001',case when display_name='Профиль 01' then 'revoked' when display_name='Профиль 02' then 'suspended' else 'active' end from public.participant_profiles where id::text like '98000000-0000-4000-8001-%';
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_supervision_profiles()->'items'),25,'страница 25');
select is(jsonb_array_length(public.search_my_participant_supervision_profiles('',null,999)->'items'),50,'максимум 50');
select is(public.search_my_participant_supervision_profiles('01')->'items'->0->>'supervision_status','revoked','находит отозванную связь');
select is(public.search_my_participant_supervision_profiles('02')->'items'->0->>'supervision_status','suspended','находит приостановленную связь');
select is(public.search_my_participant_supervision_profiles('60')->'items'->0->>'display_name','Профиль 60','поиск за первой страницей');
select is(public.search_my_participant_supervision_profiles('',public.search_my_participant_supervision_profiles()->'next_cursor')->'items'->0->>'display_name','Профиль 26','продолжение без повторов');
select is((select count(*)::integer from jsonb_object_keys(public.search_my_participant_supervision_profiles()->'items'->0)),6,'только краткие поля профиля и собственной связи');
select throws_ok($$select public.search_my_participant_supervision_profiles('другой поиск',public.search_my_participant_supervision_profiles()->'next_cursor')$$,'22023','invalid people cursor','курсор привязан к поиску');
select throws_ok($$select public.search_my_participant_supervision_profiles('',jsonb_set(public.search_my_participant_supervision_profiles()->'next_cursor','{actor_id}','"98000000-0000-4000-8000-000000000002"'))$$,'22023','invalid people cursor','курсор привязан к аккаунту');
select throws_ok($$select public.search_my_participant_supervision_profiles(repeat('x',201))$$,'22023','invalid people search','длина поиска ограничена');
select is(public.can_access_participant_profile('98000000-0000-4000-8001-000000000001'),false,'список не даёт доступа к отозванному профилю');
select lives_ok($$select public.restore_orphaned_participant_supervision('98000000-0000-4000-8001-000000000001')$$,'найденный профиль восстанавливается прежней операцией');
select is(public.search_my_participant_supervision_profiles('01')->'items'->0->>'supervision_status','active','после восстановления статус обновлён');
reset role;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_supervision_profiles()->'items'),0,'другой аккаунт не видит чужие связи');
reset role;
select ok(not has_function_privilege('anon','public.search_my_participant_supervision_profiles(text,jsonb,integer)','execute'),'anon не может вызвать каталог');
select * from finish();
rollback;
