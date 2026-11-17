-- Run only on a disposable full-schema local database, never --linked.
begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('97000000-0000-4000-8000-000000000001','identity-owner@example.test','{"username":"IdentityOwner"}'),
 ('97000000-0000-4000-8000-000000000002','identity-reader@example.test','{"username":"IdentityReader"}'),
 ('97000000-0000-4000-8000-000000000003','identity-other@example.test','{"username":"IdentityOther"}');
insert into public.participant_profiles(id,display_name,created_by_user_id) values
 ('97000000-0000-4000-8000-000000000011','Participant','97000000-0000-4000-8000-000000000001');
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id) values
 ('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000011'),
 ('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000011');
create function pg_temp.visible_avatars() returns bigint language sql as $$select count(*) from storage.objects where bucket_id='participant-avatars'$$;
select is((select public from storage.buckets where id='participant-avatars'),false,'bucket is private');
select is((select file_size_limit from storage.buckets where id='participant-avatars'),1048576::bigint,'stored byte limit');
select is((select allowed_mime_types from storage.buckets where id='participant-avatars'),array['image/png'],'only canonical PNG');
select ok(not has_function_privilege('anon','public.save_participant_identity(uuid,integer,text,uuid,boolean)','EXECUTE'),'anonymous write denied');
select ok(not has_function_privilege('authenticated','public.confirm_participant_avatar_upload(uuid,uuid)','EXECUTE'),'client cannot bypass byte validation');
select ok(not has_function_privilege('authenticated','public.claim_failed_participant_avatar(uuid,uuid)','EXECUTE'),'trusted cleanup cannot be forged');
select ok(not has_function_privilege('authenticated','public.claim_expired_participant_avatars()','EXECUTE'),'global cleanup is service-only');
select ok(not has_table_privilege('authenticated','platform_private.participant_avatar_uploads','SELECT'),'upload inventory is private');
-- Adversarial existing broad policy must not bypass the new bucket fences.
create policy "identity_test_broad_policy" on storage.objects for all to authenticated,anon using(true) with check(true);
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select ok(public.can_edit_participant_identity(public.current_self_participant_profile_id()),'self can edit');
select lives_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',0,'Explorer')$$,'creator can edit unclaimed dependent');
select is((select username from public.profiles where id=auth.uid()),'IdentityOwner','nickname does not rename account');
select is(public.get_participant_profile_card('97000000-0000-4000-8000-000000000011')->>'display_name','Participant','nickname does not rename participant');
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',0,'Stale')$$,'40001','participant identity changed','stale revision rejected');
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',1,'<svg>')$$,'22023','invalid participant identity','markup rejected');
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',1,'with space')$$,'22023','invalid participant identity','whitespace rejected');
select is(public.begin_participant_avatar('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000021',1),'97000000-0000-4000-8000-000000000011/97000000-0000-4000-8000-000000000021.png','server controls object path');
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',1,'Explorer','97000000-0000-4000-8000-000000000021')$$,'42501','avatar upload unavailable','unverified upload cannot attach');
select is(public.claim_participant_avatar_cleanup('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000021'),'[]'::jsonb,'browser cannot discard in-flight pending upload');
reset role;
-- Synthetic Storage object; byte validation is tested separately in the Edge suite.
insert into storage.objects(bucket_id,name) values('participant-avatars','97000000-0000-4000-8000-000000000011/97000000-0000-4000-8000-000000000021.png');
select public.confirm_participant_avatar_upload('97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.visible_avatars(),0::bigint,'staged bytes are unreadable even to owner');
select lives_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',1,'Explorer','97000000-0000-4000-8000-000000000021')$$,'verified own upload attaches');
select is(pg_temp.visible_avatars(),1::bigint,'owner reads current avatar');
select is(public.claim_participant_avatar_cleanup('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000021'),'[]'::jsonb,'cleanup excludes current object even on discarded-response retry');
select throws_ok($$insert into storage.objects(bucket_id,name) values('participant-avatars','forged.png')$$,'42501',null,'direct upload forbidden');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select is(pg_temp.visible_avatars(),1::bigint,'existing supervisor reads avatar');
select is(public.get_participant_profile_card('97000000-0000-4000-8000-000000000011')->>'nickname','Explorer','existing reader sees nickname');
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',2,'Other')$$,'42501','participant identity edit denied','reader has no rename right');
reset role;
update public.participant_supervisions set status='suspended' where supervisor_user_id='97000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.visible_avatars(),0::bigint,'suspended supervision loses avatar access');
select is(public.get_participant_profile_card('97000000-0000-4000-8000-000000000011')->>'nickname',null,'suspended-only card does not leak nickname');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000003',true);
select is(pg_temp.visible_avatars(),0::bigint,'unrelated actor cannot read');
select throws_ok($$select public.begin_participant_avatar('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000022',2)$$,'42501','participant identity edit denied','wrong profile upload blocked');
reset role;
insert into public.participant_groups(id,name,created_by_user_id) values('97000000-0000-4000-8000-000000000031','IdentityGroup','97000000-0000-4000-8000-000000000003');
insert into public.participant_group_members(group_id,participant_profile_id) values('97000000-0000-4000-8000-000000000031','97000000-0000-4000-8000-000000000011');
set local role authenticated;
select is(pg_temp.visible_avatars(),1::bigint,'existing group leader reads avatar');
select is((select item->>'nickname' from jsonb_array_elements(public.search_participant_group_members('97000000-0000-4000-8000-000000000031')->'items') item where item->>'id'='97000000-0000-4000-8000-000000000011'),'Explorer','target group row contains identity regardless of self-first sorting');
select ok((public.search_participant_group_members('97000000-0000-4000-8000-000000000031')->'group')?'can_leave','existing group exit contract retained');
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',2,'Leader')$$,'42501','participant identity edit denied','group leader cannot rename others');
reset role;
insert into public.participant_group_members(group_id,participant_profile_id)
 select '97000000-0000-4000-8000-000000000031',participant_profile_id from public.participant_profile_accounts
 where user_id='97000000-0000-4000-8000-000000000002' and relationship='self' and status='active';
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(pg_temp.visible_avatars(),0::bigint,'ordinary group membership does not reveal another profile avatar');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000003',true);
update public.participant_group_members set status='removed' where group_id='97000000-0000-4000-8000-000000000031';
set local role authenticated;
select is(pg_temp.visible_avatars(),0::bigint,'removed group relation loses avatar access');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select public.begin_participant_avatar('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000022',2);
reset role;
insert into storage.objects(bucket_id,name) values('participant-avatars','97000000-0000-4000-8000-000000000011/97000000-0000-4000-8000-000000000022.png');
select public.confirm_participant_avatar_upload('97000000-0000-4000-8000-000000000022','97000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_participant_identity('97000000-0000-4000-8000-000000000011',2,'Explorer','97000000-0000-4000-8000-000000000022');
select is(pg_temp.visible_avatars(),1::bigint,'replacement immediately hides old bytes');
select is(jsonb_array_length(public.claim_participant_avatar_cleanup('97000000-0000-4000-8000-000000000011')),1,'obsolete object claimed for deletion');
select public.save_participant_identity('97000000-0000-4000-8000-000000000011',3,'',null,true);
select is(pg_temp.visible_avatars(),0::bigint,'removal immediately hides all objects');
select is(public.get_participant_profile_card('97000000-0000-4000-8000-000000000011')->>'nickname',null,'empty nickname is optional');
reset role;
select is(jsonb_array_length(public.claim_expired_participant_avatars()),2,'service can reclaim obsolete objects independently of actor permissions');
select public.finish_participant_avatar_cleanup(array['97000000-0000-4000-8000-000000000021'::uuid]);
select public.finish_participant_avatar_cleanup(array['97000000-0000-4000-8000-000000000021'::uuid]);
select is((select count(*) from platform_private.participant_avatar_uploads where id='97000000-0000-4000-8000-000000000021'),0::bigint,'repeat acknowledgement removes linked metadata');
select is((select count(*) from platform_private.participant_avatar_ids where id='97000000-0000-4000-8000-000000000021'),1::bigint,'UUID-only anti-reuse ID survives acknowledgement');
set local role authenticated;
select public.begin_participant_avatar(public.current_self_participant_profile_id(),'97000000-0000-4000-8000-000000000023',0);
reset role;
insert into storage.objects(bucket_id,name) select 'participant-avatars',object_path from platform_private.participant_avatar_uploads where id='97000000-0000-4000-8000-000000000023';
select public.confirm_participant_avatar_upload('97000000-0000-4000-8000-000000000023','97000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',4,'Explorer','97000000-0000-4000-8000-000000000023')$$,'42501','avatar upload unavailable','verified bytes cannot be attached to a different profile');
reset role;
update platform_private.participant_avatar_uploads set expires_at=now()-interval '1 second' where id='97000000-0000-4000-8000-000000000023';
set local role authenticated;
select throws_ok($$select public.save_participant_identity(public.current_self_participant_profile_id(),0,'Explorer','97000000-0000-4000-8000-000000000023')$$,'42501','avatar upload unavailable','expired verified upload cannot attach');
reset role;
-- Claiming dependent profile removes its creator's edit authority.
update public.participant_profile_accounts set status='revoked',revoked_at=now() where user_id='97000000-0000-4000-8000-000000000002' and relationship='self' and status='active';
insert into public.participant_profile_accounts(participant_profile_id,user_id,relationship) values('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000002','self');
set local role authenticated;
select throws_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',4,'FormerCreator')$$,'42501','participant identity edit denied','creator loses edit after claim');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.save_participant_identity('97000000-0000-4000-8000-000000000011',4,'ClaimedSelf')$$,'claimed self edits identity');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is(pg_temp.visible_avatars(),0::bigint,'anonymous cannot read private avatars');
reset role;
select * from finish();
rollback;
