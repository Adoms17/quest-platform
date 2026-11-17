begin;
select no_plan();
insert into auth.users(id,email) values
  (md5('account-activity-a')::uuid,'account-activity-a@example.test'),
  (md5('account-activity-b')::uuid,'account-activity-b@example.test');
select is((select count(*) from public.account_activity where account_id in
  (md5('account-activity-a')::uuid,md5('account-activity-b')::uuid)),0::bigint,'no historical or registration backfill');
select ok((select relrowsecurity from pg_class where oid='public.account_activity'::regclass),'RLS enabled');
select is((select pronargs::integer from pg_proc where oid='public.record_my_account_activity()'::regprocedure),0,'RPC takes no client identity or date');

set local role anon;
select throws_ok('select public.record_my_account_activity()','42501',null,'anonymous RPC denied');
select throws_ok('select * from public.account_activity','42501',null,'anonymous read denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok('select public.record_my_account_activity()','42501','authentication required','missing UID rejected');
reset role;

select set_config('request.jwt.claim.sub',md5('account-activity-a')::uuid::text,true);
set local role authenticated;
select is(public.record_my_account_activity(),86400,'first observation accepted');
select is((select last_activity_at from public.account_activity),now(),'server time stored');
select is(public.record_my_account_activity(),86400,'immediate retry is idempotent');
select is((select count(*) from public.account_activity),1::bigint,'one row per account');
select throws_ok('update public.account_activity set last_activity_at=now()','42501',null,'direct date write denied');
select throws_ok('delete from public.account_activity','42501',null,'direct deletion denied');
select throws_ok($$insert into public.account_activity values(md5('account-activity-b')::uuid,now())$$,'42501',null,'cannot forge another account');
reset role;

update public.account_activity set last_activity_at=now()-interval '12 hours' where account_id=md5('account-activity-a')::uuid;
set local role authenticated;
select is(public.record_my_account_activity(),43200,'server supplies remaining interval');
select is((select last_activity_at from public.account_activity),now()-interval '12 hours','no write within 24 hours');
reset role;
update public.account_activity set last_activity_at=now()-interval '24 hours' where account_id=md5('account-activity-a')::uuid;
set local role authenticated;
select is(public.record_my_account_activity(),86400,'exact 24-hour boundary permits update');
select is((select last_activity_at from public.account_activity),now(),'boundary uses server time');
reset role;

select set_config('request.jwt.claim.sub',md5('account-activity-b')::uuid::text,true);
set local role authenticated;
select is((select count(*) from public.account_activity),0::bigint,'B cannot read A');
select is(public.record_my_account_activity(),86400,'B records independently');
select is((select account_id from public.account_activity),auth.uid(),'B sees only own identity');
reset role;
select is((select count(*) from public.account_activity where account_id in
  (md5('account-activity-a')::uuid,md5('account-activity-b')::uuid)),2::bigint,'two independent rows, no event history');
select * from finish();
rollback;
