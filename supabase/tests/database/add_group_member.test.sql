begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('97000000-0000-4000-8000-000000000001','add-owner@example.test','{"username":"Owner"}'),
('97000000-0000-4000-8000-000000000002','add-other@example.test','{"username":"Other"}');
insert into public.participant_profiles(id,display_name,created_by_user_id) values
('97000000-0000-4000-8000-000000000011','Участник','97000000-0000-4000-8000-000000000001');
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id) values
('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000011');
insert into public.participant_groups(id,name,created_by_user_id) values
('97000000-0000-4000-8000-000000000021','Группа','97000000-0000-4000-8000-000000000001');
create function pg_temp.add_member() returns void language sql as $$select public.add_participant_group_member('97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000011')$$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.add_member()$$,'42501','participant group management denied','чужая группа');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select pg_temp.add_member()$$,'добавление разрешено');
select lives_ok($$select pg_temp.add_member()$$,'повтор разрешён');
select is((select count(*) from public.participant_group_members where participant_profile_id='97000000-0000-4000-8000-000000000011'),1::bigint,'повтор без дубля');
select lives_ok($$select public.add_participant_group_member('97000000-0000-4000-8000-000000000021',public.current_self_participant_profile_id())$$,'добавление существующего руководителя');
select is((select member_role from public.participant_group_members where group_id='97000000-0000-4000-8000-000000000021' and participant_profile_id=public.current_self_participant_profile_id()),'leader','роль руководителя сохранена');
select throws_ok($$select public.add_participant_group_member('97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000099')$$,'42501','participant profile access denied','нет профиля');
reset role;
update public.participant_group_members set status='removed' where participant_profile_id='97000000-0000-4000-8000-000000000011';
set local role authenticated;
select lives_ok($$select pg_temp.add_member()$$,'восстановление доступного профиля');
select is((select status from public.participant_group_members where participant_profile_id='97000000-0000-4000-8000-000000000011'),'active','восстановлен');
reset role;
update public.participant_group_members set status='removed' where participant_profile_id='97000000-0000-4000-8000-000000000011';
update public.participant_supervisions set status='revoked' where participant_profile_id='97000000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok($$select pg_temp.add_member()$$,'42501','participant profile access denied','отзыв контроля запрещает восстановление');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select pg_temp.add_member()$$,'42501','participant group management denied','без аккаунта');
reset role;
select ok(not has_function_privilege('anon','public.add_participant_group_member(uuid,uuid)','execute'),'anon запрещён');
select * from finish();
rollback;
