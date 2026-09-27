-- Full-schema modeled payment fixture; period has not yet ended.
reset role;
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'123',md5('fiscal-payment')::uuid,'succeeded',true)
 on conflict(order_id) do update set status='succeeded',paid=true,payment_id=md5('fiscal-payment')::uuid,requires_review=false;
set local role authenticated;
select throws_ok($t$select public.list_due_subscription_settlements('123')$t$,'42501',null,'browser cannot enumerate due obligations');
set local role anon;
select throws_ok($t$select public.list_due_subscription_settlements('123')$t$,'42501',null,'anonymous cannot enumerate due obligations');
set local role service_role;
select is(jsonb_array_length(public.list_due_subscription_settlements('123')),0,'future period excluded');
select throws_ok($t$select public.claim_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'55000','subscription settlement not due','first dispatch before period end blocked');
reset role;
select is((select count(*) from public.billing_prepayment_settlement_status),0::bigint,'early claim consumes no dispatch');
savepoint early_body;
insert into public.billing_prepayment_settlements(order_id,body,body_sha256) values(current_setting('test.payment')::uuid,'{}','fixture-only');
set local role service_role;
select throws_ok($t$select public.claim_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'55000','subscription settlement not due','stored unsent body cannot bypass due check');
reset role;
rollback to savepoint early_body;
-- Only this disposable SQL fixture changes immutable terms to avoid waiting a month.
alter table public.billing_subscription_fiscal_terms disable trigger subscription_fiscal_terms_immutable;
update public.billing_subscription_fiscal_terms set period_start=statement_timestamp()-interval '1 month',period_end=statement_timestamp() where order_id=current_setting('test.payment')::uuid;
alter table public.billing_subscription_fiscal_terms enable trigger subscription_fiscal_terms_immutable;
set local role service_role;
select is(jsonb_array_length(public.list_due_subscription_settlements('123')),1,'period ending at server statement time is due');
select is(jsonb_array_length(public.list_due_subscription_settlements('999')),0,'due queue is shop scoped');
select throws_ok($t$select public.list_due_subscription_settlements('123',0)$t$,'22023','invalid settlement batch','zero batch rejected');
select throws_ok($t$select public.list_due_subscription_settlements('123',101)$t$,'22023','invalid settlement batch','oversized batch rejected');
select throws_ok($t$select public.list_due_subscription_settlements(null)$t$,'22023','invalid settlement batch','shop required');
select ok(not(public.list_due_subscription_settlements('123')->0 ? 'email'),'discovery omits contact');
reset role;
savepoint refund_race;
insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,first_sent_at)
 values(md5('due-refund')::uuid,current_setting('test.payment')::uuid,md5('discount-checkout-owner')::uuid,md5('due-refund-command')::uuid,1000,md5('fiscal-payment')::uuid,'sending',now());
set local role service_role;
select is(jsonb_array_length(public.list_due_subscription_settlements('123')),0,'reserved refund excludes due order');
select throws_ok($t$select public.claim_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'55000','settlement unavailable','refund after discovery blocks claim');
reset role;
rollback to savepoint refund_race;
savepoint unverified_payment;
update public.billing_sandbox_payment_results set requires_review=true where order_id=current_setting('test.payment')::uuid;
set local role service_role;
select is(jsonb_array_length(public.list_due_subscription_settlements('123')),0,'review payment excluded');
reset role;
rollback to savepoint unverified_payment;
set local role service_role;
select set_config('test.due.body',public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)::text,true);
select is(public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)::text,current_setting('test.due.body'),'repeat preparation preserves body and key');
select is(jsonb_array_length(public.list_due_subscription_settlements('123')),1,'prepared but unsent operation remains discoverable');
select is(public.claim_prepayment_settlement(current_setting('test.payment')::uuid)->>'action','send','due order can dispatch once');
select is(jsonb_array_length(public.list_due_subscription_settlements('123')),0,'unknown dispatch excluded from new work');
select is(public.claim_prepayment_settlement(current_setting('test.payment')::uuid)->>'action','reconcile','retry reconciles rather than sends');
select is(jsonb_array_length(public.list_pending_prepayment_settlements('123')),1,'unknown remains in existing reconciliation queue');
reset role;
