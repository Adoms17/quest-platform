begin;
select no_plan();
insert into auth.users(id,email) values(md5('people-admin')::uuid,'people-admin@example.test'),(md5('people-other')::uuid,'people-other@example.test');
select set_config('request.jwt.claim.sub',md5('people-admin')::uuid::text,true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
select set_config('test.other',(select id::text from public.organizations where personal_owner_id=md5('people-other')::uuid),true);
insert into public.quests(id,organization_id,creator_id,title,is_open,is_public) values
 (md5('people-quest')::uuid,current_setting('test.org')::uuid,auth.uid(),'Quest',true,true),
 (md5('people-other-quest')::uuid,current_setting('test.other')::uuid,md5('people-other')::uuid,'Other quest',true,true);
insert into public.participant_profiles(id,display_name,age_group,created_by_user_id)
 select md5('people-profile-'||n)::uuid,'Same name','unknown',auth.uid() from generate_series(1,31)n;
insert into public.quest_attempts(quest_id,user_id,actor_user_id,participant_profile_id,total_tasks,finished_at)
 select md5('people-quest')::uuid,auth.uid(),auth.uid(),md5('people-profile-'||n)::uuid,0,now() from generate_series(1,30)n;
-- Repeated attempts must not duplicate a profile. A foreign-only profile stays hidden.
insert into public.quest_attempts(quest_id,user_id,actor_user_id,participant_profile_id,total_tasks,finished_at) values
 (md5('people-quest')::uuid,auth.uid(),auth.uid(),md5('people-profile-1')::uuid,0,now()),
 (md5('people-other-quest')::uuid,auth.uid(),auth.uid(),md5('people-profile-31')::uuid,0,now());
insert into public.participant_groups(id,name,created_by_user_id) values
 (md5('people-group')::uuid,'Visible group',auth.uid()),(md5('people-hidden-group')::uuid,'Hidden group',auth.uid());
insert into public.participant_group_members(group_id,participant_profile_id) values
 (md5('people-group')::uuid,md5('people-profile-1')::uuid),
 (md5('people-group')::uuid,md5('people-profile-31')::uuid),
 (md5('people-hidden-group')::uuid,md5('people-profile-31')::uuid);
set local role authenticated;
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid)$t$,'42501','platform access denied','membership alone denied');
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind,organization_id) values(auth.uid(),'operations','organization',current_setting('test.org')::uuid);
set local role authenticated;
select set_config('test.page',public.read_platform_organization_participants(current_setting('test.org')::uuid)::text,true);
select set_config('test.next',public.read_platform_organization_participants(current_setting('test.org')::uuid,'profiles','',null,null,current_setting('test.page')::jsonb->'next_cursor')::text,true);
select is(jsonb_array_length(current_setting('test.page')::jsonb->'items'),25,'first page');
select is(jsonb_array_length(current_setting('test.next')::jsonb->'items'),5,'equal-name second page');
select is((select count(distinct x->>'id') from jsonb_array_elements((current_setting('test.page')::jsonb->'items')||(current_setting('test.next')::jsonb->'items'))x),30::bigint,'no duplicates and no foreign profiles');
select ok(not exists(select 1 from jsonb_array_elements(current_setting('test.page')::jsonb->'items')x,jsonb_object_keys(x) k where k not in ('id','name','age_group','status')),'explicit profile fields only');
select is(jsonb_array_length(public.read_platform_organization_participants(current_setting('test.org')::uuid,'profiles','%')->'items'),0,'literal search');
select is(jsonb_array_length(public.read_platform_organization_participants(current_setting('test.org')::uuid,'groups')->'items'),1,'foreign-only group hidden');
select is(public.read_platform_organization_participants(current_setting('test.org')::uuid,'profiles','',md5('people-group')::uuid)->'items'->0->>'id',md5('people-profile-1')::uuid::text,'mixed group only contains own participant');
select is(jsonb_array_length(public.read_platform_organization_participants(current_setting('test.org')::uuid,'profiles','',md5('people-group')::uuid)->'items'),1,'group does not expose full membership');
select is(jsonb_array_length(public.read_platform_organization_participants(current_setting('test.org')::uuid,'groups','',null,md5('people-profile-31')::uuid)->'items'),0,'foreign profile cannot reveal its groups');
select is(public.read_platform_organization_participants(current_setting('test.org')::uuid,'groups','',null,md5('people-profile-1')::uuid)->'items'->0,jsonb_build_object('id',md5('people-group')::uuid,'name','Visible group'),'group has no owner or hidden counts');
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.other')::uuid)$t$,'42501','platform access denied','foreign scope denied');
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid,'profiles','changed',null,null,current_setting('test.page')::jsonb->'next_cursor')$t$,'22023','invalid participant cursor','cursor bound to search');
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid,'profiles','',md5('people-group')::uuid,null,current_setting('test.page')::jsonb->'next_cursor')$t$,'22023','invalid participant cursor','cursor bound to group');
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid,'invalid')$t$,'22023','invalid participant filter','invalid kind denied');
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid)$t$,'42501','platform access denied','MFA required');
reset role;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
update public.platform_access_assignments set revoked_at=now() where user_id=auth.uid();
set local role authenticated;
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid)$t$,'42501','platform access denied','revoked denied');
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind,organization_id,valid_from,expires_at) values(auth.uid(),'operations','organization',current_setting('test.org')::uuid,now()-interval '2 days',now()-interval '1 day');
set local role authenticated;
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid)$t$,'42501','platform access denied','expired denied');
reset role;
select is((select count(*) from public.platform_role_permissions where permission_key='organization.participants.read' and role_key in ('sales','support','regional')),0::bigint,'other roles excluded');
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
set local role authenticated;
select is(jsonb_array_length(public.read_platform_organization_participants(current_setting('test.other')::uuid)->'items'),1,'owner can read other organization independently');
select throws_ok('select * from public.platform_audit_events','42501',null,'audit private');
reset role;
select ok(exists(select 1 from public.platform_audit_events where actor_id=auth.uid() and action='organization.participants.read'),'reads audited');
update public.participant_group_members set status='removed' where participant_profile_id=md5('people-profile-1')::uuid;
set local role authenticated;
select is(jsonb_array_length(public.read_platform_organization_participants(current_setting('test.org')::uuid,'groups')->'items'),0,'removed membership cannot reveal group');
reset role;
set local role anon;
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid)$t$,'42501',null,'anon denied');
reset role;
set local role service_role;
select throws_ok($t$select public.read_platform_organization_participants(current_setting('test.org')::uuid)$t$,'42501',null,'service role denied');
reset role;
select * from finish();
rollback;
