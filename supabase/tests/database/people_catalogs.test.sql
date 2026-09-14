begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('94000000-0000-4000-8000-000000000001','people-owner@example.test','{"username":"Owner"}'),
('94000000-0000-4000-8000-000000000002','people-other@example.test','{"username":"Other"}');
insert into public.participant_profiles(id,display_name,created_by_user_id)
select md5('people-'||n)::uuid,case when n=1000 then 'Дальний профиль' when n=3 then '100%_путь' else 'Профиль '||lpad((n/2)::text,4,'0') end,
'94000000-0000-4000-8000-000000000002' from generate_series(1,1000) n;
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id)
select '94000000-0000-4000-8000-000000000001',md5('people-'||n)::uuid from generate_series(1,1000) n;
insert into public.participant_groups(id,name,created_by_user_id)
select md5('people-group-'||n)::uuid,case when n=1000 then 'Дальняя группа' else 'Группа '||lpad((n/2)::text,4,'0') end,
'94000000-0000-4000-8000-000000000001' from generate_series(1,1000) n;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_profiles()->'items'),25,'профили: 25 по умолчанию');
select is(jsonb_array_length(public.search_my_participant_groups()->'items'),25,'группы: 25 по умолчанию');
select is(jsonb_array_length(public.search_my_participant_profiles(p_limit=>999)->'items'),50,'профили: максимум 50');
select is(jsonb_array_length(public.search_my_participant_groups(p_limit=>0)->'items'),1,'группы: минимум 1');
select is(public.search_my_participant_profiles()->'items'->0->>'relationship','self','собственный профиль первым');
select is(jsonb_array_length(public.search_my_participant_profiles('дАЛЬНий')->'items'),1,'поиск дальней записи');
select is(jsonb_array_length(public.search_my_participant_profiles('%_')->'items'),1,'спецсимволы буквально');
select is(jsonb_array_length(public.search_my_participant_groups('ДАЛЬНЯЯ')->'items'),1,'поиск группы');
select is(public.search_my_participant_profiles('нет записи')->'next_cursor','null'::jsonb,'пустая выдача без курсора');
select throws_ok($$select public.search_my_participant_profiles(repeat('x',201))$$,'22023','invalid people search','ограничение длины');
select throws_ok($$select public.search_my_participant_groups(p_after=>public.search_my_participant_profiles()->'next_cursor')$$,'22023','invalid people cursor','курсор нельзя перенести между каталогами');
select throws_ok($$select public.search_my_participant_profiles('другой',public.search_my_participant_profiles()->'next_cursor')$$,'22023','invalid people cursor','курсор привязан к поиску');
select throws_ok($$select public.search_my_participant_profiles(p_after=>'null'::jsonb)$$,'22023','invalid people cursor','JSON null отклонён');
create temporary table people_seen(id uuid primary key);
create temporary table groups_seen(id uuid primary key);
do $$declare p jsonb; c jsonb; begin loop
 p:=public.search_my_participant_profiles(p_after=>c,p_limit=>50);
 insert into people_seen select (x->>'id')::uuid from jsonb_array_elements(p->'items') x;
 exit when not (p->>'has_more')::boolean; c:=p->'next_cursor';
end loop; c:=null; loop
 p:=public.search_my_participant_groups(p_after=>c,p_limit=>50);
 insert into groups_seen select (x->>'id')::uuid from jsonb_array_elements(p->'items') x;
 exit when not (p->>'has_more')::boolean; c:=p->'next_cursor';
end loop; end$$;
select is((select count(*) from people_seen),1001::bigint,'1000 профилей и собственный без пропусков и дублей');
select is((select count(*) from groups_seen),1000::bigint,'1000 групп без пропусков и дублей');
select ok(not ((public.search_my_participant_profiles()->'items'->0) ?| array['account_email','owner_email','members']),'контакты не попадают в каталог профилей');
select ok(not ((public.search_my_participant_groups()->'items'->0) ? 'members'),'состав не загружается со списком групп');
select throws_ok($$select public.search_my_participant_profiles(p_after=>(public.search_my_participant_profiles()->'next_cursor')||'{"id":"bad"}'::jsonb)$$,'22023','invalid people cursor','повреждённый UUID курсора отклонён');
select set_config('test.people_cursor',(public.search_my_participant_profiles()->'next_cursor')::text,true);
reset role;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_groups()->'items'),0,'чужие группы скрыты');
select is(jsonb_array_length(public.search_my_participant_profiles()->'items'),1,'создание профиля само по себе не даёт контроль');
select throws_ok($$select public.search_my_participant_profiles(p_after=>current_setting('test.people_cursor')::jsonb)$$,'22023','invalid people cursor','курсор другого аккаунта отклонён');
reset role;
insert into public.participant_group_members(group_id,participant_profile_id,member_role)
select md5('people-group-1')::uuid,participant_profile_id,'member' from public.participant_profile_accounts where user_id='94000000-0000-4000-8000-000000000002' and relationship='self';
insert into public.participant_group_members(group_id,participant_profile_id) values(md5('people-group-1')::uuid,md5('people-1')::uuid);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_groups()->'items'),1,'участник видит собственную группу');
select is(public.search_my_participant_groups()->'items'->0->>'can_manage','false','участие не даёт управление');
select is(jsonb_array_length(public.search_my_participant_profiles()->'items'),1,'участие не открывает другие профили');
reset role;
update public.participant_group_members set member_role='leader' where group_id=md5('people-group-1')::uuid and participant_profile_id<>md5('people-1')::uuid;
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_profiles()->'items'),3,'руководитель видит себя, профиль создателя и зависимый профиль группы');
reset role;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
update public.participant_supervisions set status='suspended' where participant_profile_id=md5('people-2')::uuid;
update public.participant_supervisions set status='revoked' where participant_profile_id in (md5('people-1')::uuid,md5('people-1000')::uuid);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_profiles('Дальний')->'items'),0,'отзыв применяется при новом запросе');
select ok(exists(select 1 from jsonb_array_elements(public.search_my_participant_profiles('Профиль 0001')->'items') p where p->>'id'=md5('people-2')::uuid::text and p->>'can_participate'='false'),'приостановленный контроль виден для управления, без права прохождения');
select ok(exists(select 1 from jsonb_array_elements(public.search_my_participant_profiles('Профиль 0000')->'items') p where p->>'id'=md5('people-1')::uuid::text and p->>'can_participate'='true'),'отзыв отдельного контроля не отменяет независимое управление группой');
reset role;
update public.participant_profiles set status='archived' where id=md5('people-3')::uuid;
update public.participant_groups set status='archived' where id=md5('people-group-1000')::uuid;
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_profiles('%_')->'items'),0,'архивный профиль скрыт');
select is(jsonb_array_length(public.search_my_participant_groups('Дальняя')->'items'),0,'архивная группа скрыта');
reset role;
update public.participant_group_members set status='removed' where group_id=md5('people-group-1')::uuid and participant_profile_id in (select participant_profile_id from public.participant_profile_accounts where user_id='94000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(public.search_my_participant_groups()->'items'),0,'отзыв участия убирает группу');
select is(jsonb_array_length(public.search_my_participant_profiles()->'items'),1,'отзыв руководства убирает профили группы');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select public.search_my_participant_profiles()$$,'42501','people catalog access denied','без actor отказ');
reset role;
select ok(not has_function_privilege('anon','public.search_my_participant_profiles(text,jsonb,integer)','EXECUTE'),'anon не может вызывать профили');
select ok(not has_function_privilege('anon','public.search_my_participant_groups(text,jsonb,integer)','EXECUTE'),'anon не может вызывать группы');
select * from finish();
rollback;
