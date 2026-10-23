begin;
select no_plan();
insert into auth.users(id,email) select md5('reconcile-'||n)::uuid,'reconcile-'||n||'@example.test' from generate_series(1,3) n;
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),period_start=now()-interval '2 days',period_end=now()-interval '1 day'
where organization_id in(select id from public.organizations where personal_owner_id in(select md5('reconcile-'||n)::uuid from generate_series(1,3) n));
select set_config('test.reconcile_plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select public.record_organization_subscription_expiration(id,1) from public.organizations where personal_owner_id in(md5('reconcile-1')::uuid,md5('reconcile-2')::uuid);
select lives_ok($$select public.confirm_organization_subscription_period((select id from public.organizations where personal_owner_id=md5('reconcile-1')::uuid),md5('reconciled')::uuid,1,current_setting('test.reconcile_plan')::uuid,now()-interval '2 days',now()+interval '29 days')$$,'audited expiration permits original request');
select is((select request->>'revision' from public.billing_period_confirmations where confirmation_id=md5('reconciled')::uuid),'1','original revision retained');
select is((select expiration_source_revision from public.billing_period_confirmations where confirmation_id=md5('reconciled')::uuid),1::bigint,'reconciliation evidence retained');
select lives_ok($$select public.confirm_organization_subscription_period((select id from public.organizations where personal_owner_id=md5('reconcile-1')::uuid),md5('reconciled')::uuid,1,current_setting('test.reconcile_plan')::uuid,now()-interval '2 days',now()+interval '29 days')$$,'retry idempotent');
-- Любая последующая правка, даже если она потом отменена, нарушает доказательство.
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=(select id from public.organizations where personal_owner_id=md5('reconcile-2')::uuid);
update public.organization_subscriptions set cancel_at_period_end=false where organization_id=(select id from public.organizations where personal_owner_id=md5('reconcile-2')::uuid);
select throws_ok($$select public.confirm_organization_subscription_period((select id from public.organizations where personal_owner_id=md5('reconcile-2')::uuid),md5('changed')::uuid,1,current_setting('test.reconcile_plan')::uuid,now()-interval '2 days',now()+interval '29 days')$$,'40001','billing revision conflict','other changes still conflict');
update public.organization_subscriptions set status='expired' where organization_id=(select id from public.organizations where personal_owner_id=md5('reconcile-3')::uuid);
select throws_ok($$select public.confirm_organization_subscription_period((select id from public.organizations where personal_owner_id=md5('reconcile-3')::uuid),md5('no-evidence')::uuid,1,current_setting('test.reconcile_plan')::uuid,now()-interval '2 days',now()+interval '29 days')$$,'40001','billing revision conflict','no journal means no exception');
select * from finish();
rollback;
