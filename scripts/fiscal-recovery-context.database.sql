-- DEFERRED / NOT RUN. psql + pgTAP, owner-created disposable full-chain fixture only.
-- Candidate must already be installed by a separately authorized test operator.
-- Requires qvesta.test.recovery_context_command_id for the synthetic sending/unknown
-- linked fixture and current confirmed period. NEVER use shared/hosted data.
\set ON_ERROR_STOP on
begin;
set local search_path=public,extensions;
\ir fiscal-recovery-context.fixture.sql
select plan(28);
do $$
declare e platform_private.recovery_context_fixture_evidence%rowtype;
begin
 select * into e from platform_private.recovery_context_fixture_evidence
  where command_id=current_setting('qvesta.test.recovery_context_command_id')::uuid;
 if not found then raise exception 'fixture missing'; end if;
 perform set_config('qvesta.test.r_actor',e.dispatch_actor::text,true);
 perform set_config('qvesta.test.r_evidence',e.id::text,true);
 perform set_config('qvesta.test.r_refund',e.refund_id::text,true);
 perform set_config('qvesta.test.r_shop',e.shop_id,true);
end; $$;
-- Owner-only test function; never part of the candidate/API.
create function pg_temp.domain_hash() returns text language plpgsql as $$
declare tab text; value jsonb; snap jsonb:='{}';
begin
 foreach tab in array array['organization_subscriptions','subscription_refund_requests',
 'subscription_refund_reservations','subscription_refund_period_bindings','subscription_refund_dispatches',
 'subscription_refund_applications','billing_sandbox_orders','billing_sandbox_refunds',
 'billing_sandbox_payment_results','billing_subscription_fiscal_ledgers',
 'billing_subscription_fiscal_operations','billing_subscription_fiscal_operation_status',
 'billing_recurring_orders','billing_recurring_dispatches','billing_recurring_results'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',tab) into value;
  snap:=snap||jsonb_build_object(tab,value);
 end loop;
 return md5(snap::text);
end; $$;
do $$begin perform set_config('qvesta.test.r_before',pg_temp.domain_hash(),true); end;$$;

select ok((select relrowsecurity from pg_class where oid='platform_private.recovery_context_fixture_evidence'::regclass),'fixture evidence RLS enabled');
select ok(not has_table_privilege(role,'platform_private.recovery_context_fixture_evidence','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),role||' has no direct table privilege') from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_function_privilege(role,'platform_private.read_recovery_context(uuid,bigint,bigint,text,uuid,uuid)','EXECUTE'),role||' has no private reader execute') from unnest(array['anon','authenticated','service_role']) role;
select ok(has_function_privilege('service_role','public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb)','EXECUTE'),'existing service gateway execute retained');
select is((select count(*)::int from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='platform_private.read_recovery_context(uuid,bigint,bigint,text,uuid,uuid)'::regprocedure and a.grantee=0),0,'PUBLIC has no private execute');

set local role anon;
select throws_ok('select * from platform_private.recovery_context_fixture_evidence','42501',null,'anon table read denied');
select throws_ok('select platform_private.read_recovery_context(null,null,null,null,null,null)','42501',null,'anon private reader denied');
select throws_ok('select public.subscription_fiscal_refund_from_gateway(null,null,null,null,null,null,null)','42501',null,'anon gateway denied');
reset role;
set local role authenticated;
select throws_ok('select * from platform_private.recovery_context_fixture_evidence','42501',null,'authenticated table read denied');
select throws_ok('select platform_private.read_recovery_context(null,null,null,null,null,null)','42501',null,'authenticated private reader denied');
select throws_ok('select public.subscription_fiscal_refund_from_gateway(null,null,null,null,null,null,null)','42501',null,'authenticated gateway denied');
reset role;
set local role service_role;
select throws_ok('select * from platform_private.recovery_context_fixture_evidence','42501',null,'service table read denied');
select throws_ok('select platform_private.read_recovery_context(null,null,null,null,null,null)','42501',null,'service private reader denied');
select throws_ok('select public.subscription_fiscal_refund_from_gateway(null,null,null,null,null,null,null)','42501',null,'service gateway without verified context denied');
select is(public.subscription_fiscal_refund_from_gateway(current_setting('qvesta.test.r_actor')::uuid,
 floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+120,
 current_setting('qvesta.test.r_shop'),'read_recovery_context',current_setting('qvesta.test.recovery_context_command_id')::uuid,
 jsonb_build_object('evidenceId',current_setting('qvesta.test.r_evidence')))->>'dispatchId',current_setting('qvesta.test.r_refund'),'authorized R maps dispatch key exactly');
-- Construct exact test call once; no token, provider credentials or arbitrary server input.
do $$begin perform set_config('qvesta.test.r_call',format(
 'select public.subscription_fiscal_refund_from_gateway(%L::uuid,%s,%s,%L,%L,%L::uuid,%L::jsonb)',
 current_setting('qvesta.test.r_actor'),floor(extract(epoch from clock_timestamp())),floor(extract(epoch from clock_timestamp()))+120,
 current_setting('qvesta.test.r_shop'),'read_recovery_context',current_setting('qvesta.test.recovery_context_command_id'),
 jsonb_build_object('evidenceId',current_setting('qvesta.test.r_evidence'))::text),true);end;$$;
select throws_ok(replace(current_setting('qvesta.test.r_call'),current_setting('qvesta.test.r_evidence'),'ffffffff-ffff-4fff-8fff-ffffffffffff'),'42501','recovery context denied','missing evidence has uniform denial');
select throws_ok(replace(current_setting('qvesta.test.r_call'),current_setting('qvesta.test.r_evidence'),current_setting('qvesta.test.r_refund')),'42501','recovery context denied','unrelated ID has same denial');
select throws_ok(format('select public.subscription_fiscal_refund_from_gateway(%L::uuid,1,2,%L,%L,%L::uuid,%L::jsonb)',current_setting('qvesta.test.r_actor'),current_setting('qvesta.test.r_shop'),'read_recovery_context',current_setting('qvesta.test.recovery_context_command_id'),jsonb_build_object('evidenceId',current_setting('qvesta.test.r_evidence'))::text),'42501',null,'expired context denied');
select throws_ok(format('select public.subscription_fiscal_refund_from_gateway(%L::uuid,1,%s,%L,%L,%L::uuid,%L::jsonb)',current_setting('qvesta.test.r_actor'),floor(extract(epoch from clock_timestamp()))+120,current_setting('qvesta.test.r_shop'),'read_recovery_context',current_setting('qvesta.test.recovery_context_command_id'),jsonb_build_object('evidenceId',current_setting('qvesta.test.r_evidence'))::text),'42501',null,'stale MFA denied');
select throws_ok(replace(current_setting('qvesta.test.r_call'),'"evidenceId"','"providerRefundId"'),'42501','recovery context denied','extra/provider payload denied');
select throws_ok(replace(current_setting('qvesta.test.r_call'),'read_recovery_context','append_recovery_evidence'),'42501',null,'E action absent');
select throws_ok(replace(current_setting('qvesta.test.r_call'),'read_recovery_context','commit_recovery_a'),'42501',null,'C action absent');
select throws_ok(replace(current_setting('qvesta.test.r_call'),current_setting('qvesta.test.r_actor'),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'42501',null,'unknown actor denied');
reset role;
select is(pg_temp.domain_hash(),current_setting('qvesta.test.r_before'),'R/denials cause zero domain writes');
select * from finish();
rollback;
-- Still required separately: two-backend lock-wait expiry/MFA/role/scope tests,
-- wrong existing evidence owned by another prepared command, production/unpinned
-- guard negatives, immutable evidence DML negatives, scoped-CAS related/unrelated
-- writes and competing-writer lock order. This file has NOT been executed.
