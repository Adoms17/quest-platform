begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('99000000-0000-4000-8000-000000000001','role-owner@example.test','{"username":"Owner"}'),
('99000000-0000-4000-8000-000000000002','role-other@example.test','{"username":"Other"}');
insert into public.participant_groups(id,name,created_by_user_id) values('99000000-0000-4000-8000-000000000021','Группа','99000000-0000-4000-8000-000000000001');
insert into public.participant_group_members(group_id,participant_profile_id) select '99000000-0000-4000-8000-000000000021',participant_profile_id from public.participant_profile_accounts where user_id='99000000-0000-4000-8000-000000000002' and relationship='self';
create function pg_temp.remove_member() returns void language sql as $$select public.remove_participant_group_member('99000000-0000-4000-8000-000000000021',(select participant_profile_id from public.participant_profile_accounts where user_id='99000000-0000-4000-8000-000000000002' and relationship='self'))$$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(public.search_participant_group_members('99000000-0000-4000-8000-000000000021')->'group'->>'can_leave','true','участник может выйти');
select throws_ok($$select pg_temp.remove_member()$$,'42501','participant group management denied','обычный участник не удаляет состав');
reset role;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(public.search_participant_group_members('99000000-0000-4000-8000-000000000021')->'group'->>'can_leave','false','создателю не предлагают выход');
select lives_ok($$select pg_temp.remove_member()$$,'руководитель удаляет членство');
select lives_ok($$select pg_temp.remove_member()$$,'повтор не создаёт новых изменений');
reset role;
select is((select m.status from public.participant_group_members m join public.participant_profile_accounts a on a.participant_profile_id=m.participant_profile_id where a.user_id='99000000-0000-4000-8000-000000000002' and m.group_id='99000000-0000-4000-8000-000000000021'),'removed','членство снято');
select is((select count(*) from public.participant_profile_accounts where user_id='99000000-0000-4000-8000-000000000002' and status='active'),1::bigint,'профиль и аккаунт сохранены');
select ok(not has_function_privilege('anon','public.remove_participant_group_member(uuid,uuid)','execute'),'anon запрещён');
select * from finish();
rollback;
