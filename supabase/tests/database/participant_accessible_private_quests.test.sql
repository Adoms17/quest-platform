begin;
select plan(7);

insert into auth.users(id,email,raw_user_meta_data) values
('9d000000-0000-4000-8000-000000000001','private-quest-owner@example.test','{"username":"Организатор"}'),
('9d000000-0000-4000-8000-000000000002','private-quest-adult@example.test','{"username":"Взрослый"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000001',true);
select set_config('app.test_private_child',public.create_dependent_participant_profile('Участник','child',null)::text,true);

reset role;
insert into public.quests(id,creator_id,title,description,is_public,is_open) values
('9d100000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001','Закрытый доступный','Описание',false,true),
('9d100000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000001','Закрытый остановленный','Описание',false,false);
insert into public.quest_access_grants(quest_id,user_id,participant_profile_id) values
('9d100000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000002',current_setting('app.test_private_child')::uuid),
('9d100000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000002');
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id)
values('9d000000-0000-4000-8000-000000000002',current_setting('app.test_private_child')::uuid);

set local role authenticated;
select set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000002',true);
select set_config('app.test_private_group',public.create_participant_group('Группа')::text,true);
select public.set_participant_group_member(current_setting('app.test_private_group')::uuid,current_setting('app.test_private_child')::uuid,'member','active');
select is((select count(*) from public.get_my_accessible_private_quests()),1::bigint,'only an open private quest is listed');
select is((select participants -> 0 ->> 'display_name' from public.get_my_accessible_private_quests()),'Участник','available participant is included');
select is((select participants -> 0 ->> 'owner_email' from public.get_my_accessible_private_quests()),'private-quest-owner@example.test','participant owner identity is included');

select public.revoke_my_participant_supervision(current_setting('app.test_private_child')::uuid);
select is((select count(*) from public.get_my_accessible_private_quests()),1::bigint,'group leadership keeps the quest available after explicit control is revoked');
select public.set_participant_group_member(current_setting('app.test_private_group')::uuid,current_setting('app.test_private_child')::uuid,'member','removed');
select is((select count(*) from public.get_my_accessible_private_quests()),0::bigint,'removing the profile from the group updates the list immediately');

reset role;
update public.participant_supervisions set status='active'
where supervisor_user_id='9d000000-0000-4000-8000-000000000002'
  and participant_profile_id=current_setting('app.test_private_child')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.get_my_accessible_private_quests()),1::bigint,'restoring profile control restores the quest in the list');

reset role;
update public.participant_supervisions set status='revoked'
where supervisor_user_id='9d000000-0000-4000-8000-000000000002'
  and participant_profile_id=current_setting('app.test_private_child')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.get_my_accessible_private_quests()),0::bigint,'revoking the remaining control removes the quest again');

select * from finish();
rollback;
