begin;
select no_plan();
insert into auth.users(id,email) values(md5('evaluation-owner')::uuid,'evaluation-owner@example.test');
select set_config('test.eval_org',(select id::text from public.organizations where personal_owner_id=md5('evaluation-owner')::uuid),true);
select is(public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid)->>'outcome','none','no intent');
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
  period_start=now()-interval '1 day',period_end=now()+interval '1 day' where organization_id=current_setting('test.eval_org')::uuid;
update public.organization_subscriptions set scheduled_plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1),scheduled_effective_at=period_end
  where organization_id=current_setting('test.eval_org')::uuid;
select is(public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid)->>'outcome','scheduled','early call stays scheduled');
select is((select count(*)::int from public.billing_intent_evaluations where organization_id=current_setting('test.eval_org')::uuid),0,'no early receipt');
-- Синтетическая фикстура наступившего срока с согласованным снимком.
update public.organization_subscriptions set scheduled_plan_version_id=null,scheduled_effective_at=null where organization_id=current_setting('test.eval_org')::uuid;
update public.organization_subscriptions set period_start=now()-interval '2 days',period_end=now()-interval '1 day' where organization_id=current_setting('test.eval_org')::uuid;
update public.organization_subscriptions set scheduled_plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1),scheduled_effective_at=period_end
  where organization_id=current_setting('test.eval_org')::uuid;
select set_config('test.eval_before',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.eval_org')::uuid),true);
set local role service_role;
select set_config('test.eval_receipt',public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid)::text,true);
select is(current_setting('test.eval_receipt')::jsonb->>'outcome','due','server records due');
select is(public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid),current_setting('test.eval_receipt')::jsonb,'retry returns exact receipt');
reset role;
select is((select to_jsonb(s) from public.organization_subscriptions s where organization_id=current_setting('test.eval_org')::uuid),current_setting('test.eval_before')::jsonb,'evaluation does not mutate subscription');
select is((select count(*)::int from public.billing_intent_evaluations where organization_id=current_setting('test.eval_org')::uuid),1,'one audit entry');
update public.organization_subscriptions set period_end=period_end+interval '1 month' where organization_id=current_setting('test.eval_org')::uuid;
select is(public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid)->>'outcome','stale','renewal cannot reuse old due result');
select is((select count(*)::int from public.billing_intent_evaluations where organization_id=current_setting('test.eval_org')::uuid),2,'new revision preserves old audit');
select set_config('request.jwt.claim.sub',md5('evaluation-owner')::uuid::text,true);
set local role authenticated;
select throws_ok($$select public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid)$$,'42501',null,'even owner cannot run server evaluation');
select throws_ok($$select * from public.billing_intent_evaluations$$,'42501',null,'owner cannot read private audit');
set local role anon;
select throws_ok($$select public.evaluate_organization_billing_intent(current_setting('test.eval_org')::uuid)$$,'42501',null,'anonymous denied');
reset role;
select throws_ok($$select public.evaluate_organization_billing_intent(md5('missing-eval')::uuid)$$,'P0001','billing state missing','missing subscription rejected');
select * from finish();
rollback;
