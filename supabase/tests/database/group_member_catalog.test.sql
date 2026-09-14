begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('95000000-0000-4000-8000-000000000001','members-owner@example.test','{"username":"Owner"}'),
('95000000-0000-4000-8000-000000000002','members-other@example.test','{"username":"Other"}');
insert into public.participant_groups(id,name,created_by_user_id) values
('95000000-0000-4000-8000-000000000011','Большая группа','95000000-0000-4000-8000-000000000001'),
('95000000-0000-4000-8000-000000000012','Другая группа','95000000-0000-4000-8000-000000000001');
insert into public.participant_profiles(id,display_name,created_by_user_id)
select md5('member-'||n)::uuid,case when n=1000 then 'Дальний участник' when n=3 then '100%_путь' else 'Участник '||lpad((n/2)::text,4,'0') end,
'95000000-0000-4000-8000-000000000002' from generate_series(1,1000) n;
insert into public.participant_group_members(group_id,participant_profile_id)
select '95000000-0000-4000-8000-000000000011',md5('member-'||n)::uuid from generate_series(1,1000) n;
create function pg_temp.members(s text default '',c jsonb default null,l integer default 25)
returns jsonb language sql as $$select public.search_participant_group_members('95000000-0000-4000-8000-000000000011',s,c,l)$$;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.members()->'items'),25,'порция 25');
select is(jsonb_array_length(pg_temp.members(l=>999)->'items'),50,'максимум 50');
select is(jsonb_array_length(pg_temp.members(l=>0)->'items'),1,'минимум 1');
select is(pg_temp.members()->'group'->>'name','Большая группа','метаданные выбранной группы');
select is(pg_temp.members()->'group'->>'can_manage','true','создатель управляет');
select is(pg_temp.members()->'items'->0->>'is_current_user','true','свой профиль первым');
select is(jsonb_array_length(pg_temp.members('дАЛЬНий')->'items'),1,'поиск дальней записи');
select is(jsonb_array_length(pg_temp.members('%_')->'items'),1,'спецсимволы буквально');
select is(pg_temp.members('нет записи')->'next_cursor','null'::jsonb,'пустая выдача без курсора');
select throws_ok($$select pg_temp.members(repeat('a',201))$$,'22023','invalid people search','длина поиска');
select throws_ok($$select pg_temp.members('другой',pg_temp.members()->'next_cursor')$$,'22023','invalid people cursor','поиск связан с курсором');
select throws_ok($$select public.search_participant_group_members('95000000-0000-4000-8000-000000000012',p_after=>pg_temp.members()->'next_cursor')$$,'22023','invalid people cursor','курсор связан с группой');
select throws_ok($$select pg_temp.members(c=>'null'::jsonb)$$,'22023','invalid people cursor','JSON null отклонён');
create temporary table members_seen(id uuid primary key);
do $$declare p jsonb; c jsonb; begin loop
p:=pg_temp.members(c=>c,l=>50);
insert into members_seen select (x->>'id')::uuid from jsonb_array_elements(p->'items') x;
exit when not (p->>'has_more')::boolean; c:=p->'next_cursor';
end loop;end$$;
select is((select count(*) from members_seen),1001::bigint,'1000 участников и создатель без пропусков и дублей');
select ok(not exists(select 1 from jsonb_object_keys(pg_temp.members()->'items'->0) k where k not in ('id','display_name','profile_kind','member_role','is_current_user','sort_priority','sort_name')),'ограниченная проекция без контактов');
select ok(not (pg_temp.members() ? 'total'),'нет общего количества скрытых участников');
reset role;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.members()$$,'42501','people catalog access denied','чужая группа недоступна');
select throws_ok($$select public.search_participant_group_members('95000000-0000-4000-8000-000000000099')$$,'42501','people catalog access denied','несуществующая группа неотличима от чужой');
reset role;
insert into public.participant_group_members(group_id,participant_profile_id)
select '95000000-0000-4000-8000-000000000011',participant_profile_id from public.participant_profile_accounts where user_id='95000000-0000-4000-8000-000000000002' and relationship='self';
set local role authenticated;
select is(jsonb_array_length(pg_temp.members()->'items'),1,'обычному участнику доступен только собственный профиль');
select is(pg_temp.members()->'group'->>'can_manage','false','участие не даёт управление');
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),0,'поиск не раскрывает скрытый профиль');
reset role;
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id) values('95000000-0000-4000-8000-000000000002',md5('member-1000')::uuid);
set local role authenticated;
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),1,'отдельный активный контроль открывает профиль обычному участнику');
reset role;
update public.participant_supervisions set status='suspended' where supervisor_user_id='95000000-0000-4000-8000-000000000002';
insert into public.participant_group_members(group_id,participant_profile_id,member_role)
select '95000000-0000-4000-8000-000000000012',participant_profile_id,'leader' from public.participant_profile_accounts where user_id='95000000-0000-4000-8000-000000000002' and relationship='self';
insert into public.participant_group_members(group_id,participant_profile_id) values('95000000-0000-4000-8000-000000000012',md5('member-1000')::uuid);
set local role authenticated;
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),1,'руководство другой группой сохраняет доступ при приостановленном контроле');
reset role;
update public.participant_group_members set status='removed' where group_id='95000000-0000-4000-8000-000000000012' and participant_profile_id in (select participant_profile_id from public.participant_profile_accounts where user_id='95000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),0,'приостановленный контроль без независимого основания не раскрывает профиль');

reset role;
update public.participant_group_members set member_role='leader' where group_id='95000000-0000-4000-8000-000000000011' and participant_profile_id in (select participant_profile_id from public.participant_profile_accounts where user_id='95000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),1,'руководитель получает доступ к составу');
select set_config('test.members_cursor',(pg_temp.members()->'next_cursor')::text,true);
reset role;
update public.participant_group_members set member_role='member' where group_id='95000000-0000-4000-8000-000000000011' and participant_profile_id in (select participant_profile_id from public.participant_profile_accounts where user_id='95000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),0,'понижение роли скрывает чужие профили');
select is(jsonb_array_length(pg_temp.members(c=>current_setting('test.members_cursor')::jsonb)->'items'),0,'старый курсор не сохраняет право видеть состав');
reset role;
update public.participant_group_members set status='removed' where group_id='95000000-0000-4000-8000-000000000011' and participant_profile_id in (select participant_profile_id from public.participant_profile_accounts where user_id='95000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select pg_temp.members()$$,'42501','people catalog access denied','отзыв участия закрывает группу');
reset role;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
update public.participant_profiles set status='archived' where id=md5('member-1000')::uuid;
set local role authenticated;
select is(jsonb_array_length(pg_temp.members('Дальний')->'items'),0,'архивный профиль скрыт');
reset role;
update public.participant_groups set status='archived' where id='95000000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok($$select pg_temp.members()$$,'42501','people catalog access denied','архивная группа недоступна');
reset role;
select ok(not has_function_privilege('anon','public.search_participant_group_members(uuid,text,jsonb,integer)','EXECUTE'),'anon не может читать состав');
select * from finish();
rollback;
