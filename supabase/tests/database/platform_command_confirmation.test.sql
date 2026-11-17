begin;
select no_plan();
insert into auth.users(id,email) select md5('confirmation-'||n)::uuid,'confirmation-'||n||'@example.test' from generate_series(1,2)n;
select platform_private.bootstrap_owner(md5('confirmation-bootstrap')::uuid,md5('confirmation-1')::uuid);
select set_config('request.jwt.claim.sub',md5('confirmation-1')::uuid::text,true);
create function pg_temp.grant_role() returns uuid language sql as $$select public.grant_platform_assignment(md5('confirmation-command')::uuid,md5('confirmation-2')::uuid,'sales',p_reason_code=>'role_change')$$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok('select pg_temp.grant_role()','42501','recent platform MFA required','aal2 без времени MFA недостаточно');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','iat',floor(extract(epoch from clock_timestamp())),
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))-301)))::text,true);
set local role authenticated;
select throws_ok('select pg_temp.grant_role()','42501','recent platform MFA required','свежий iat не заменяет старый TOTP');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
set local role authenticated;
select throws_ok('select pg_temp.grant_role()','42501','recent platform MFA required','пароль не заменяет MFA');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))+60)))::text,true);
set local role authenticated;
select throws_ok('select pg_temp.grant_role()','42501','recent platform MFA required','будущая дата отклоняется');
reset role;
select set_config('request.jwt.claims','{"aal":"aal2","amr":{"method":"totp"}}',true);
set local role authenticated;
select throws_ok('select pg_temp.grant_role()','42501','recent platform MFA required','неверная форма amr закрывает доступ');
reset role;
select set_config('request.jwt.claims','{"aal":"aal2","amr":[{"method":"totp","timestamp":"invalid"}]}',true);
set local role authenticated;
select throws_ok('select pg_temp.grant_role()','42501','recent platform MFA required','неверное время закрывает доступ');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(
 jsonb_build_object('method','password','timestamp',floor(extract(epoch from clock_timestamp()))),
 jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))-10)))::text,true);
set local role authenticated;
select set_config('test.confirmation_assignment',pg_temp.grant_role()::text,true);
select is(pg_temp.grant_role()::text,current_setting('test.confirmation_assignment'),'свежий MFA и retry работают');
select lives_ok($$select public.revoke_platform_assignment(md5('confirmation-revoke')::uuid,current_setting('test.confirmation_assignment')::uuid,p_reason_code=>'role_change')$$,'отзыв с подтверждением');
reset role;
select is((select count(*)::int from public.platform_audit_events where command_id=md5('confirmation-command')::uuid),1,'одна запись команды при retry');
select ok((select before_assignment->>'revoked_at' is null and after_assignment->>'revoked_at' is not null
 from public.platform_audit_events where assignment_id=current_setting('test.confirmation_assignment')::uuid and action='assignment.updated'),'аудит показывает отзыв до/после');
select is((select after_assignment->>'role' from public.platform_audit_events where assignment_id=current_setting('test.confirmation_assignment')::uuid and action='assignment.created'),'sales','аудит показывает выданную роль');
select ok(not exists(select 1 from public.platform_audit_events where after_assignment ? 'amr' or after_assignment ? 'email'),'JWT и контакты не сохраняются в аудите');
select * from finish();
rollback;
