-- Disposable database only: advance synthetic immutable dates, never real orders.
reset role;
alter table public.billing_sandbox_orders disable trigger sandbox_order_terms;
alter table public.billing_subscription_fiscal_terms disable trigger subscription_fiscal_terms_immutable;
update public.billing_sandbox_orders set period_start=clock_timestamp()-interval '1 hour',period_end=clock_timestamp()-interval '1 second' where id=current_setting('test.payment')::uuid;
update public.billing_subscription_fiscal_terms t set period_start=o.period_start,period_end=o.period_end from public.billing_sandbox_orders o where t.order_id=o.id and o.id=current_setting('test.payment')::uuid;
alter table public.billing_sandbox_orders enable trigger sandbox_order_terms;
alter table public.billing_subscription_fiscal_terms enable trigger subscription_fiscal_terms_immutable;
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'1467641',md5('fiscal-payment')::uuid,'succeeded',true)
 on conflict(order_id) do update set status='succeeded',paid=true,requires_review=false;
insert into public.billing_sandbox_settlement_schedule(order_id,amount_minor,period_end,expires_at,enabled)
 select id,amount_minor,period_end,period_end+interval '1 hour',true from public.billing_sandbox_orders where id=current_setting('test.payment')::uuid;
-- Replace transport transactionally; this test can never issue external HTTP.
create table public.test_settlement_http(headers jsonb,url text);
create or replace function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$
begin insert into public.test_settlement_http values(headers,url); return 42; end; $$;
select vault.create_secret(repeat('ab',32),'qvesta_stage_reconcile_worker_token');
select ok(platform_private.settlement_schedule_eligible(current_setting('test.payment')::uuid),'due exact target eligible');
savepoint wrong_amount;
update public.billing_sandbox_settlement_schedule set amount_minor=amount_minor+1;
select ok(not platform_private.settlement_schedule_eligible(current_setting('test.payment')::uuid),'wrong amount rejected');
rollback to savepoint wrong_amount;
savepoint revoked;
update public.billing_sandbox_settlement_schedule set enabled=false;
select throws_ok($t$select public.claim_scheduled_subscription_settlement(current_setting('test.payment')::uuid)$t$,'55000','scheduled settlement denied','revocation blocks claim');
rollback to savepoint revoked;
select is(platform_private.run_scheduled_subscription_settlements()->>'sent','1','due schedule queues one signed call');
select is((select count(*) from public.test_settlement_http),1::bigint,'only one HTTP request');
select ok((select not(headers ? 'x-qvesta-worker-token') from public.test_settlement_http),'queue excludes worker token');
select ok((select headers->>'x-qvesta-order-signature'=encode(extensions.hmac('qvesta-order-settlement-v1'||chr(10)||current_setting('test.payment')||chr(10)||(headers->>'x-qvesta-order-timestamp'),repeat('ab',32),'sha256'),'hex') from public.test_settlement_http),'signature binds purpose order and time');
select is(platform_private.run_scheduled_subscription_settlements()->>'sent','0','immediate repeat respects backoff');
set local role service_role;
select is(public.claim_scheduled_subscription_settlement(current_setting('test.payment')::uuid)->>'action','send','authorized claim sends once');
select is(public.claim_scheduled_subscription_settlement(current_setting('test.payment')::uuid)->>'action','reconcile','second claim only reconciles');
reset role;
savepoint exhausted;
update public.billing_sandbox_settlement_schedule set attempts=6;
select is(platform_private.run_scheduled_subscription_settlements()->>'sent','0','attempt limit prevents send');
select is((select stop_reason from public.billing_sandbox_settlement_schedule),'attempt_limit','attempt limit disables target');
rollback to savepoint exhausted;
savepoint expired;
update public.billing_sandbox_settlement_schedule set expires_at=clock_timestamp()-interval '0.1 second';
select is(platform_private.run_scheduled_subscription_settlements()->>'sent','0','expired target not sent');
select is((select stop_reason from public.billing_sandbox_settlement_schedule),'expired','expiry disables target');
rollback to savepoint expired;
select public.record_prepayment_settlement(current_setting('test.payment')::uuid,'rt-schedule-test','succeeded');
select is(platform_private.run_scheduled_subscription_settlements()->>'sent','0','success prevents another send');
select is((select stop_reason from public.billing_sandbox_settlement_schedule),'succeeded','registered receipt stops schedule');
select is((select count(*) from public.billing_prepayment_settlements where order_id=current_setting('test.payment')::uuid),1::bigint,'one durable settlement after repeats');
