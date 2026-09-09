begin;
select plan(18);

insert into auth.users(id,email,raw_user_meta_data) values
('9e000000-0000-4000-8000-000000000001','group-invite-owner@example.test','{"username":"Owner"}'),
('9e000000-0000-4000-8000-000000000002','group-invite-member@example.test','{"username":"Member"}'),
('9e000000-0000-4000-8000-000000000003','group-invite-outsider@example.test','{"username":"Outsider"}');

select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('app.test_group_invite_group',public.create_participant_group('Команда')::text,true);
select set_config('app.test_owner_child',public.create_dependent_participant_profile('Ребёнок владельца','child',current_setting('app.test_group_invite_group')::uuid)::text,true);
select set_config('app.test_group_invite_token',(select invitation_token from public.create_participant_group_invitation(current_setting('app.test_group_invite_group')::uuid,'group-invite-member@example.test')),true);
select is((select count(*) from public.get_my_participant_group_invitations()),1::bigint,'manager lists sent group invitation');

reset role;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*) from public.get_participant_group_invitation_preview(current_setting('app.test_group_invite_token'))),0::bigint,'another email cannot preview group invitation');

reset role;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select group_name from public.get_participant_group_invitation_preview(current_setting('app.test_group_invite_token'))),'Команда','recipient previews group');
select lives_ok(format($$select public.accept_participant_group_invitation(%L)$$,current_setting('app.test_group_invite_token')),'recipient accepts group invitation');
select is((select jsonb_array_length(members) from public.get_my_participant_groups()),1,'ordinary member sees only their own profile in group');
select is((select account_email from public.get_my_participant_profiles() where relationship='self'),'group-invite-member@example.test','self profile exposes its linked account email');
select throws_ok($$select * from public.get_participant_quest_history('9e000000-0000-4000-8000-000000000001')$$,'42501','participant history access denied','ordinary member cannot read another group member history');

reset role;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok(format($$select public.set_participant_group_member(%L::uuid,'9e000000-0000-4000-8000-000000000002','leader','active')$$,current_setting('app.test_group_invite_group')),'manager promotes account profile to group leader');

reset role;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select jsonb_array_length(members) from public.get_my_participant_groups()),3,'leader sees every profile in group');
select is((select owner_email from public.get_my_participant_profiles() where participant_profile_id=current_setting('app.test_owner_child')::uuid),'group-invite-owner@example.test','dependent profile identifies its owner email');
select is((select member ->> 'owner_username' from public.get_my_participant_groups(), jsonb_array_elements(members) member where member ->> 'participant_profile_id'=current_setting('app.test_owner_child')),'Owner','group member card identifies the dependent profile owner');
select ok(public.can_access_participant_profile(current_setting('app.test_owner_child')::uuid),'leader controls dependent profile in group');
select lives_ok(format($$select * from public.get_participant_quest_history(%L::uuid)$$,current_setting('app.test_owner_child')),'leader can read group participant history');
select set_config('app.test_member_child',public.create_dependent_participant_profile('Ребёнок руководителя','child',current_setting('app.test_group_invite_group')::uuid)::text,true);
select is((select jsonb_array_length(members) from public.get_my_participant_groups()),4,'leader adds their dependent profile directly to group');
select lives_ok(format($$select public.leave_participant_group(%L::uuid)$$,current_setting('app.test_group_invite_group')),'invited leader can leave group');
select is((select count(*) from public.get_my_participant_groups()),0::bigint,'group disappears for departed member');

reset role;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select jsonb_array_length(members) from public.get_my_participant_groups()),2,'departed user and their dependent profiles leave together');
select is((select status from public.participant_group_members where group_id=current_setting('app.test_group_invite_group')::uuid and participant_profile_id=current_setting('app.test_member_child')::uuid),'removed','dependent profile membership is removed');

select * from finish();
rollback;
