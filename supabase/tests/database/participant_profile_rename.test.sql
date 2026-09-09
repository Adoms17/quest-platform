begin;
select plan(8);

insert into auth.users(id,email,raw_user_meta_data) values
('9f000000-0000-4000-8000-000000000001','rename-owner@example.test','{"username":"Владелец"}'),
('9f000000-0000-4000-8000-000000000002','rename-adult@example.test','{"username":"Второй взрослый"}'),
('9f000000-0000-4000-8000-000000000003','rename-child@example.test','{"username":"Отдельный аккаунт"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.update_my_participant_profile_name('9f000000-0000-4000-8000-000000000001','Новое имя владельца')$$,'account holder renames their self profile');
select is((select username from public.profiles where id='9f000000-0000-4000-8000-000000000001'),'Новое имя владельца','self profile name is synchronized to dependent owner labels');
select set_config('app.test_rename_profile',public.create_dependent_participant_profile('Ребёнок','child',null)::text,true);
select lives_ok(format($$select public.update_my_participant_profile_name(%L::uuid,'Новое имя ребёнка')$$,current_setting('app.test_rename_profile')),'creator renames an unclaimed dependent profile');
select is((select display_name from public.participant_profiles where id=current_setting('app.test_rename_profile')::uuid),'Новое имя ребёнка','dependent profile name is updated');

reset role;
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id)
values('9f000000-0000-4000-8000-000000000002',current_setting('app.test_rename_profile')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000002',true);
select throws_ok(format($$select public.update_my_participant_profile_name(%L::uuid,'Чужое имя')$$,current_setting('app.test_rename_profile')),'42501','participant profile rename denied','a supervisor cannot rename another owner profile');

reset role;
delete from public.participant_profile_accounts
where user_id='9f000000-0000-4000-8000-000000000003'
  and relationship='self';
insert into public.participant_profile_accounts(participant_profile_id,user_id,relationship)
values(current_setting('app.test_rename_profile')::uuid,'9f000000-0000-4000-8000-000000000003','self');
set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select throws_ok(format($$select public.update_my_participant_profile_name(%L::uuid,'Имя от создателя')$$,current_setting('app.test_rename_profile')),'42501','participant profile rename denied','creator cannot rename a profile after it gets its own account');

select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000003',true);
select lives_ok(format($$select public.update_my_participant_profile_name(%L::uuid,'Имя самостоятельного профиля')$$,current_setting('app.test_rename_profile')),'new account holder can rename the claimed profile');
select throws_ok(format($$select public.update_my_participant_profile_name(%L::uuid,'   ')$$,current_setting('app.test_rename_profile')),'22023','invalid participant display name','blank profile name is rejected');

select * from finish();
rollback;
