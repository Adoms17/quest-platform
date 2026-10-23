begin;
select no_plan();
insert into auth.users(id,email) values(md5('short-fixture-owner')::uuid,'short-fixture@example.test');
select set_config('request.jwt.claim.sub',md5('short-fixture-owner')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
select set_config('test.fixture.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
-- Synthetic disposable organization: model the required empty Free state.
update public.organization_subscriptions set status='free',plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1),period_start=null,period_end=null,trial_access_id=null where organization_id=current_setting('test.fixture.org')::uuid;
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
insert into public.billing_sandbox_application_scope values(current_setting('test.fixture.org')::uuid);
insert into public.billing_fiscal_acceptance_fixtures(id,organization_id,actor_id,plan_version_id,expected_revision,expires_at)
select md5('short-fixture')::uuid,s.organization_id,auth.uid(),(select id from public.billing_plan_versions where plan_key='pro' and version=1),s.revision,clock_timestamp()+interval '1 hour' from public.organization_subscriptions s where s.organization_id=current_setting('test.fixture.org')::uuid;
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(gen_random_uuid(),'short@example.test')$t$,'42501','fiscal fixture denied','unknown fixture denied');
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')$t$,'55000','fiscal fixture model unavailable','fixture requires modeled policy');
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
values(md5('short-policy')::uuid,'sandbox','1467641',clock_timestamp()+interval '1 second',1,'service','full_prepayment');
insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)
values(md5('short-policy')::uuid,'subscription','subscription_access_v1','ausn','period_end');
select pg_sleep(1.1);
set local role anon;
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')$t$,'42501',null,'anon cannot prepare fixture');
select throws_ok($t$select public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,md5('short-fixture')::uuid,'short@example.test')$t$,'42501',null,'anon cannot call gateway');
set local role authenticated;
select throws_ok($t$select public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,md5('short-fixture')::uuid,'short@example.test')$t$,'42501',null,'browser cannot impersonate gateway actor');
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')$t$,'42501',null,'browser cannot prepare fixture');
set local role service_role;
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')$t$,'42501',null,'service cannot bypass identity gateway');
select throws_ok($t$select public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,0,9999999999,md5('short-fixture')::uuid,'short@example.test')$t$,'42501','invalid fiscal fixture context','stale MFA denied');
select throws_ok($t$select public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,0,md5('short-fixture')::uuid,'short@example.test')$t$,'42501','invalid fiscal fixture context','expired token denied');

select throws_ok($t$select * from public.billing_fiscal_acceptance_fixtures$t$,'42501',null,'service cannot read or provision allowlist');
select throws_ok($t$select public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,md5('short-fixture')::uuid,'invalid')$t$,'22023','invalid receipt email','invalid receipt rolls back order');
reset role;
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.fixture.org')::uuid),0::bigint,'fixture preparation atomic rollback');
select ok((select order_id is null from public.billing_fiscal_acceptance_fixtures where id=md5('short-fixture')::uuid),'failed preparation does not consume fixture');
set local role service_role;
select set_config('test.fixture.result',public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,md5('short-fixture')::uuid,'short@example.test')::text,true);
select is(public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,md5('short-fixture')::uuid,'short@example.test')::text,current_setting('test.fixture.result'),'fixture retry returns immutable result');
select throws_ok($t$select public.prepare_fiscal_acceptance_from_gateway(md5('short-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,md5('short-fixture')::uuid,'changed@example.test')$t$,'22023','receipt command conflict','fixture retry rejects contact change');
reset role;
select is(auth.uid(),md5('short-fixture-owner')::uuid,'gateway restores caller identity');
select ok(not (current_setting('request.jwt.claims')::jsonb ? 'exp'),'gateway restores original claims');
select is(current_setting('test.fixture.result')::jsonb->>'amountMinor','99000','fixture amount fixed');
select is((select period_end-period_start from public.billing_sandbox_orders where id=(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid),interval '30 minutes','fixture period fixed before payment');
select ok((select o.period_start=t.period_start and o.period_end=t.period_end and o.amount_minor=r.amount_minor from public.billing_sandbox_orders o join public.billing_subscription_fiscal_terms t on t.order_id=o.id join public.billing_receipt_snapshots r on r.order_id=o.id where o.id=(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid),'fixture order and receipt terms agree');
select ok((select state='reserved' and first_sent_at is null from public.billing_sandbox_orders where id=(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid),'fixture does not send payment');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.fixture.org')::uuid),'free','fixture does not grant access');
select throws_ok($t$update public.billing_fiscal_acceptance_fixtures set expires_at=expires_at+interval '1 hour' where id=md5('short-fixture')::uuid$t$,'55000','fiscal fixture immutable','fixture terms cannot change');
select throws_ok($t$update public.billing_sandbox_orders set period_end=period_end+interval '1 hour' where id=(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid$t$,'55000','sandbox order terms immutable','fixture order dates cannot change');
select ok(not(current_setting('test.fixture.result') like '%@%'),'fixture result omits contact');

savepoint fixture_access_checks;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')$t$,'42501',null,'fixture requires fresh owner MFA on retry');
rollback to fixture_access_checks;
delete from public.billing_sandbox_application_scope where organization_id=current_setting('test.fixture.org')::uuid;
select throws_ok($t$select public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')$t$,'42501','fiscal fixture denied','revoked scope denies retry');
rollback to fixture_access_checks;
-- Isolated SQL simulation of already verified payment: no provider request.
select public.confirm_organization_subscription_period(organization_id,id,expected_revision,plan_version_id,period_start,period_end)
 from public.billing_sandbox_orders where id=(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid;
select ok((select s.period_start=o.period_start and s.period_end=o.period_end and s.status='active' from public.organization_subscriptions s join public.billing_sandbox_orders o on o.organization_id=s.organization_id where o.id=(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid),'short period accepted by existing access confirmation');
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values((current_setting('test.fixture.result')::jsonb->>'orderId')::uuid,'1467641',md5('short-payment')::uuid,'succeeded',true);
select set_config('test.fixture.refund',public.request_platform_subscription_refund(current_setting('test.fixture.org')::uuid,(current_setting('test.fixture.result')::jsonb->>'orderId')::uuid,md5('short-refund')::uuid)->>'id',true);
select lives_ok($t$select platform_private.bind_subscription_refund_period(current_setting('test.fixture.refund')::uuid)$t$,'short period refund binds to exact confirmed dates');
select is(public.prepare_fiscal_acceptance_fixture(md5('short-fixture')::uuid,'short@example.test')::text,current_setting('test.fixture.result'),'retry after issued period preserves original dates');
select * from finish();
rollback;
