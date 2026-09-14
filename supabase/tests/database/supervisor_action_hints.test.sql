begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('96000000-0000-4000-8000-000000000001','creator@example.test','{"username":"Creator"}'),
('96000000-0000-4000-8000-000000000002','adult@example.test','{"username":"Adult"}');
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id) values
('96000000-0000-4000-8000-000000000099','Участник','dependent','child','96000000-0000-4000-8000-000000000001');
insert into public.participant_supervisions(participant_profile_id,supervisor_user_id) values
('96000000-0000-4000-8000-000000000099','96000000-0000-4000-8000-000000000001'),
('96000000-0000-4000-8000-000000000099','96000000-0000-4000-8000-000000000002');
create function pg_temp.row_for(p_email text) returns jsonb language sql as $$select public.search_participant_supervisors('96000000-0000-4000-8000-000000000099',p_email)->'items'->0$$;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(pg_temp.row_for('adult@')->>'can_revoke','true','создатель может отозвать другого взрослого');
select is(pg_temp.row_for('creator@')->>'can_restore','false','активную связь не восстанавливают');
select lives_ok($$select public.revoke_participant_supervisor('96000000-0000-4000-8000-000000000099','96000000-0000-4000-8000-000000000002')$$,'отзыв через прежний RPC');
select is(pg_temp.row_for('adult@')->>'can_revoke','false','повторный отзыв не предлагается');
select throws_ok($$select public.revoke_my_participant_supervision('96000000-0000-4000-8000-000000000099')$$,'22023','last participant supervisor cannot be revoked','сервер защищает последнего взрослого');
reset role;
update public.participant_supervisions set status='revoked' where participant_profile_id='96000000-0000-4000-8000-000000000099';
set local role authenticated;
select is(pg_temp.row_for('creator@')->>'can_restore','true','создателю доступно восстановление');
select lives_ok($$select public.restore_orphaned_participant_supervision('96000000-0000-4000-8000-000000000099')$$,'существующий RPC восстанавливает сиротский профиль');
select is(pg_temp.row_for('creator@')->>'can_restore','false','после восстановления действие скрыто');
reset role;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(pg_temp.row_for('adult@')->>'can_restore','false','другой взрослый не восстанавливает отозванную связь');
select throws_ok($$select public.restore_orphaned_participant_supervision('96000000-0000-4000-8000-000000000099')$$,'42501','participant supervision recovery denied','сервер запрещает восстановление чужому взрослому');
select * from finish();
rollback;
