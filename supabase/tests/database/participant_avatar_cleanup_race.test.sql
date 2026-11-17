-- Deterministic interleaving on a disposable full-schema database only.
-- Calls represent committed RPC steps; synthetic Storage deletes stand in for
-- service-role Storage HTTP. This is not a multi-connection/real-HTTP test.
begin;
-- Storage 1.70 guards SQL deletion. Enable only inside this rolled-back fixture;
-- the separate HTTP harness uses the Storage API without this override.
set local storage.allow_delete_query='true';
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('98000000-0000-4000-8000-000000000001','avatar-race@example.test','{"username":"AvatarRace"}');
insert into public.participant_profiles(id,display_name,created_by_user_id) values
 ('98000000-0000-4000-8000-000000000011','RaceProfile','98000000-0000-4000-8000-000000000001');
insert into public.participant_supervisions(supervisor_user_id,participant_profile_id) values
 ('98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000011');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.begin_participant_avatar('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000021',0);
reset role;
insert into storage.objects(bucket_id,name) values('participant-avatars','98000000-0000-4000-8000-000000000011/98000000-0000-4000-8000-000000000021.png');
select public.confirm_participant_avatar_upload('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_participant_identity('98000000-0000-4000-8000-000000000011',0,'First','98000000-0000-4000-8000-000000000021');
select public.save_participant_identity('98000000-0000-4000-8000-000000000011',1,'First',null,true);
-- Two workers retain the same obsolete path before either Storage request finishes.
select set_config('avatar_test.claim_a',public.claim_participant_avatar_cleanup('98000000-0000-4000-8000-000000000011')::text,true);
select set_config('avatar_test.claim_b',public.claim_participant_avatar_cleanup('98000000-0000-4000-8000-000000000011')::text,true);
select is(jsonb_array_length(current_setting('avatar_test.claim_a')::jsonb),1,'first worker claims old object');
select is(current_setting('avatar_test.claim_a'),current_setting('avatar_test.claim_b'),'second worker holds identical path');
reset role;
-- Worker A deletes and acknowledges. Its reservation must survive.
delete from storage.objects where bucket_id='participant-avatars' and name=current_setting('avatar_test.claim_a')::jsonb->0->>'path';
select public.finish_participant_avatar_cleanup(array['98000000-0000-4000-8000-000000000021'::uuid]);
select is((select count(*) from platform_private.participant_avatar_uploads where id='98000000-0000-4000-8000-000000000021'),0::bigint,'physical deletion removes linked upload metadata');
select is((select count(*) from platform_private.participant_avatar_ids where id='98000000-0000-4000-8000-000000000021'),1::bigint,'physical deletion keeps UUID-only anti-reuse ID');
set local role authenticated;
select throws_ok($$select public.begin_participant_avatar('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000021',2)$$,'23505',null,'same UUID cannot allocate old key after cleanup');
select throws_ok($$select public.begin_participant_avatar(public.current_self_participant_profile_id(),'98000000-0000-4000-8000-000000000021',0)$$,'23505',null,'UUID remains reserved across profiles');
select public.begin_participant_avatar('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000022',2);
reset role;
insert into storage.objects(bucket_id,name) values('participant-avatars','98000000-0000-4000-8000-000000000011/98000000-0000-4000-8000-000000000022.png');
select public.confirm_participant_avatar_upload('98000000-0000-4000-8000-000000000022','98000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_participant_identity('98000000-0000-4000-8000-000000000011',2,'Second','98000000-0000-4000-8000-000000000022');
reset role;
-- Worker B finally deletes its previously captured key and acknowledges again.
delete from storage.objects where bucket_id='participant-avatars' and name=current_setting('avatar_test.claim_b')::jsonb->0->>'path';
select public.finish_participant_avatar_cleanup(array['98000000-0000-4000-8000-000000000021'::uuid]);
select is((select count(*) from storage.objects where bucket_id='participant-avatars' and name='98000000-0000-4000-8000-000000000011/98000000-0000-4000-8000-000000000022.png'),1::bigint,'late delete preserves new current bytes');
select is((select avatar_path from public.participant_profiles where id='98000000-0000-4000-8000-000000000011'),'98000000-0000-4000-8000-000000000011/98000000-0000-4000-8000-000000000022.png','current reference remains valid');
-- No linked row remains for any claim path to revive.
select is(public.claim_failed_participant_avatar('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000021'),'[]'::jsonb,'failed-upload cleanup cannot revive tombstone');
select is(public.claim_expired_participant_avatars(),'[]'::jsonb,'maintenance excludes retired UUIDs and current object');
set local role authenticated;
select is(public.claim_participant_avatar_cleanup('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000021'),'[]'::jsonb,'actor cleanup cannot revive tombstone');
select throws_ok($$select public.save_participant_identity('98000000-0000-4000-8000-000000000011',3,'Second','98000000-0000-4000-8000-000000000021')$$,'42501','avatar upload unavailable','deleted reservation cannot attach');
reset role;
select throws_ok($$select public.confirm_participant_avatar_upload('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000001')$$,'22023','avatar upload expired','deleted reservation cannot become ready');
-- Exact retention schema: one UUID column, no extra attributes or references.
select is((select array_agg(attname::text order by attnum) from pg_attribute where attrelid='platform_private.participant_avatar_ids'::regclass and attnum>0 and not attisdropped),array['id'],'anti-reuse table stores UUID only');
select is((select atttypid from pg_attribute where attrelid='platform_private.participant_avatar_ids'::regclass and attname='id'),'uuid'::regtype::oid,'anti-reuse identifier is UUID');
select is((select count(*) from pg_constraint where contype='f' and (conrelid='platform_private.participant_avatar_ids'::regclass or confrelid='platform_private.participant_avatar_ids'::regclass)),0::bigint,'no incoming or outgoing anti-reuse FK');
select ok((select relrowsecurity from pg_class where oid='platform_private.participant_avatar_ids'::regclass),'UUID-only table retains RLS');
select ok(not has_table_privilege('authenticated','platform_private.participant_avatar_ids','SELECT,INSERT,UPDATE,DELETE'),'client cannot inspect or mutate anti-reuse set');
select ok(not has_table_privilege('service_role','platform_private.participant_avatar_ids','SELECT,INSERT,UPDATE,DELETE'),'service has no direct anti-reuse table privileges');
-- Finish the new current avatar, then delete the synthetic dependent profile.
set local role authenticated;
select public.save_participant_identity('98000000-0000-4000-8000-000000000011',3,'Second',null,true);
select public.claim_participant_avatar_cleanup('98000000-0000-4000-8000-000000000011');
reset role;
delete from storage.objects where bucket_id='participant-avatars' and name='98000000-0000-4000-8000-000000000011/98000000-0000-4000-8000-000000000022.png';
select public.finish_participant_avatar_cleanup(array['98000000-0000-4000-8000-000000000022'::uuid]);
select is((select count(*) from platform_private.participant_avatar_uploads where profile_id='98000000-0000-4000-8000-000000000011'),0::bigint,'cleanup removes all linked metadata for test profile');
select lives_ok($$delete from public.participant_profiles where id='98000000-0000-4000-8000-000000000011'$$,'completed avatars no longer block profile deletion');
select is((select count(*) from public.participant_profiles where id='98000000-0000-4000-8000-000000000011'),0::bigint,'synthetic profile is deleted');
select is((select count(*) from platform_private.participant_avatar_ids where id in('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000022')),2::bigint,'unlinked anti-reuse survives deletion');
set local role authenticated;
select throws_ok($$select public.begin_participant_avatar(public.current_self_participant_profile_id(),'98000000-0000-4000-8000-000000000021',0)$$,'23505',null,'deleted profile cannot free its old UUID for another profile');
reset role;
-- A failed begin must not leave an ID reservation without its live upload.
create function pg_temp.fail_avatar_reservation() returns trigger language plpgsql as $$
begin raise exception 'injected upload insert failure'; end;
$$;
create trigger avatar_test_fail_insert before insert on platform_private.participant_avatar_uploads
 for each row execute function pg_temp.fail_avatar_reservation();
set local role authenticated;
select throws_ok($$select public.begin_participant_avatar(public.current_self_participant_profile_id(),'98000000-0000-4000-8000-000000000023',0)$$,'P0001','injected upload insert failure','failure after UUID reserve rolls back entire begin');
reset role;
select is((select count(*) from platform_private.participant_avatar_ids where id='98000000-0000-4000-8000-000000000023'),0::bigint,'failed begin leaves no anti-reuse row');
select is((select count(*) from platform_private.participant_avatar_uploads where id='98000000-0000-4000-8000-000000000023'),0::bigint,'failed begin leaves no linked row');
drop trigger avatar_test_fail_insert on platform_private.participant_avatar_uploads;
set local role authenticated;
select lives_ok($$select public.begin_participant_avatar(public.current_self_participant_profile_id(),'98000000-0000-4000-8000-000000000023',0)$$,'failed transaction does not consume the never-used UUID');
reset role;
select * from finish();
rollback;
