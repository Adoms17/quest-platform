-- Runs inside the paid checkout transaction, after platform_order_documents.
reset role;
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values(md5('receipt-initial-policy')::uuid,'sandbox','123',now()-interval '1 hour',1,'service','full_prepayment');
set local role authenticated;
select set_config('test.receipt',public.prepare_sandbox_receipt(current_setting('test.payment')::uuid,'receipt@example.test')::text,true);
select is((current_setting('test.receipt')::jsonb->>'amount_minor'),'6172','receipt uses real discounted payment amount');
select is(public.prepare_sandbox_receipt(current_setting('test.payment')::uuid,'receipt@example.test')::text,current_setting('test.receipt'),'real schema retry preserves snapshot');
select throws_ok($t$select public.prepare_sandbox_receipt(current_setting('test.payment')::uuid,'other@example.test')$t$,'22023','receipt command conflict','changed contact rejected');
select throws_ok($t$select * from public.billing_receipt_snapshots$t$,'42501',null,'direct contact access closed');
select throws_ok($t$select public.create_sandbox_fiscal_policy(md5('receipt-future-policy')::uuid,'123',now()+interval '1 day',2,'service','full_payment')$t$,'42501','platform owner required','workspace owner cannot change fiscal policy');
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
set local role authenticated;
select lives_ok($t$select public.create_sandbox_fiscal_policy(md5('receipt-future-policy')::uuid,'123',now()+interval '1 day',2,'service','full_payment')$t$,'real owner and MFA create policy');
select is(public.prepare_sandbox_receipt(current_setting('test.payment')::uuid,'receipt@example.test')::text,current_setting('test.receipt'),'future policy preserves receipt');
select is(public.list_sandbox_fiscal_policies('123')->'items'->0->>'display_status','scheduled','future policy listed first');
select is(public.list_sandbox_fiscal_policies('123')->'items'->1->>'display_status','current','current policy identified');
select is(jsonb_array_length(public.list_sandbox_fiscal_policies('456')->'items'),0,'other shop not mixed');
select throws_ok($t$select public.list_sandbox_fiscal_policies(null)$t$,'22023','invalid fiscal policy query','invalid query rejected');
reset role;
select is((select count(*) from public.billing_receipt_audit),1::bigint,'one receipt audit');
select is((select count(*) from public.billing_fiscal_policy_audit),1::bigint,'one policy audit');
insert into auth.users(id,email) values(md5('receipt-other-user')::uuid,'other-receipt@example.test');
select set_config('request.jwt.claim.sub',md5('receipt-other-user')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
select throws_ok($t$select public.prepare_sandbox_receipt(current_setting('test.payment')::uuid,'receipt@example.test')$t$,'42501','receipt access denied','other workspace owner cannot recover receipt');
select throws_ok($t$select public.list_sandbox_fiscal_policies('123')$t$,'42501','platform owner required','non-owner cannot read policies');
reset role;

reset role;
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
select public.begin_sandbox_payment_send(current_setting('test.payment')::uuid);
select set_config('test.fiscal.body',jsonb_build_object(
 'amount',jsonb_build_object('value','61.72','currency','RUB'),'capture',true,
 'metadata',jsonb_build_object('order_id',o.id,'organization_id',o.organization_id,'plan_version_id',o.plan_version_id,'environment','sandbox'),
 'receipt',jsonb_build_object('customer',jsonb_build_object('email',s.email),'items',jsonb_build_array(jsonb_build_object(
 'description',s.description,'quantity','1.000','amount',jsonb_build_object('value','61.72','currency','RUB'),
 'vat_code',s.vat_code,'payment_subject',s.payment_subject,'payment_mode',s.payment_mode)))
 )::text,true),set_config('test.fiscal.key',o.idempotency_key::text,true)
 from public.billing_sandbox_orders o join public.billing_receipt_snapshots s on s.order_id=o.id where o.id=current_setting('test.payment')::uuid;
set local role authenticated;
select throws_ok($t$select public.save_sandbox_receipt_request(current_setting('test.payment')::uuid,current_setting('test.fiscal.key')::uuid,current_setting('test.fiscal.body')::jsonb)$t$,'42501',null,'browser cannot forge fiscal request');
select throws_ok($t$select public.record_sandbox_receipt_status(current_setting('test.payment')::uuid,md5('fiscal-payment')::uuid,'succeeded')$t$,'42501',null,'browser cannot forge fiscal success');
set local role service_role;
select set_config('test.fiscal.saved',public.save_sandbox_receipt_request(current_setting('test.payment')::uuid,current_setting('test.fiscal.key')::uuid,current_setting('test.fiscal.body')::jsonb)::text,true);
select is(public.save_sandbox_receipt_request(current_setting('test.payment')::uuid,current_setting('test.fiscal.key')::uuid,current_setting('test.fiscal.body')::jsonb)::text,current_setting('test.fiscal.saved'),'repeated request is unchanged');
select throws_ok($t$select public.save_sandbox_receipt_request(current_setting('test.payment')::uuid,current_setting('test.fiscal.key')::uuid,current_setting('test.fiscal.body')::jsonb||'{"capture":false}'::jsonb)$t$,'22023','receipt request conflict','same key with changed body rejected');
select lives_ok($t$select public.record_sandbox_receipt_status(current_setting('test.payment')::uuid,md5('fiscal-payment')::uuid,'pending')$t$,'pending fiscal result stored');
select public.record_sandbox_receipt_status(current_setting('test.payment')::uuid,md5('fiscal-payment')::uuid,'succeeded');
select public.record_sandbox_receipt_status(current_setting('test.payment')::uuid,md5('fiscal-payment')::uuid,'pending');
select throws_ok($t$select public.record_sandbox_receipt_status(current_setting('test.payment')::uuid,md5('wrong-payment')::uuid,'succeeded')$t$,'22023','receipt payment conflict','different provider payment rejected');
select throws_ok($t$select * from public.billing_receipt_payment_requests$t$,'42501',null,'raw request access denied even to service role');
set local role authenticated;
select is(public.read_sandbox_receipt_status(current_setting('test.payment')::uuid)->>'status','succeeded','late pending cannot overwrite registered receipt');
select ok(not(public.read_sandbox_receipt_status(current_setting('test.payment')::uuid)?'email'),'status excludes receipt contact');
reset role;
select is((select count(*) from public.billing_receipt_payment_requests),1::bigint,'one immutable request');
select throws_ok($t$update public.billing_receipt_payment_requests set body='{}'::jsonb$t$,'55000','fiscal record immutable','request immutable even to privileged caller');
select set_config('request.jwt.claim.sub',md5('receipt-other-user')::uuid::text,true);
set local role authenticated;
select throws_ok($t$select public.read_sandbox_receipt_status(current_setting('test.payment')::uuid)$t$,'42501','receipt access denied','other workspace cannot read receipt status');
reset role;
set local role authenticated;
select throws_ok($t$select public.list_pending_sandbox_receipts()$t$,'42501',null,'browser cannot enumerate fiscal orders');
set local role service_role;
select is(jsonb_array_length(public.list_pending_sandbox_receipts()),0,'registered receipts excluded from polling');
select throws_ok($t$select public.list_pending_sandbox_receipts(101)$t$,'22023','invalid receipt batch','batch is bounded');
reset role;
reset role;
select set_config('request.jwt.claim.sub',md5('receipt-other-user')::uuid::text,true);
set local role authenticated;
select throws_ok($t$select public.read_sandbox_receipt_contact(current_setting('test.payment')::uuid)$t$,'42501','receipt access denied','other workspace cannot read contact');
reset role;
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
set local role authenticated;
select is(public.read_sandbox_receipt_contact(current_setting('test.payment')::uuid)->>'email','receipt@example.test','buyer restores original contact');
select is(public.read_sandbox_receipt_contact(current_setting('test.payment')::uuid)->>'canPrepare','false','sent order cannot prepare new receipt');
reset role;
reset role;
savepoint settlement_fixture;
set local role authenticated;
select throws_ok($t$select public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'42501',null,'browser cannot prepare settlement');
reset role;
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'123',md5('fiscal-payment')::uuid,'pending',false)
 on conflict(order_id) do update set status='pending',paid=false;
set local role service_role;
select throws_ok($t$select public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'55000','settlement unavailable','unpaid order cannot settle');
reset role;
update public.billing_sandbox_payment_results set status='succeeded',paid=true,payment_id=md5('fiscal-payment')::uuid,requires_review=false where order_id=current_setting('test.payment')::uuid;
set local role service_role;
select set_config('test.settlement',public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)::text,true);
select is(public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)::text,current_setting('test.settlement'),'settlement retry keeps key and body');
select is(current_setting('test.settlement')::jsonb#>>'{body,items,0,payment_mode}','full_payment','settlement uses full payment');
select is(current_setting('test.settlement')::jsonb#>>'{body,settlements,0,amount,value}','61.72','settlement preserves discounted amount');
select throws_ok('select * from public.billing_prepayment_settlements','42501',null,'raw settlement hidden from service role');
reset role;
select ok((select relrowsecurity from pg_class where oid='public.billing_prepayment_settlements'::regclass),'settlement RLS enabled');
select throws_ok($t$update public.billing_prepayment_settlements set body='{}'::jsonb$t$,'55000','fiscal record immutable','settlement body immutable');
insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,first_sent_at)
 values(md5('settlement-refund')::uuid,current_setting('test.payment')::uuid,auth.uid(),md5('settlement-refund-command')::uuid,1000,md5('fiscal-payment')::uuid,'sending',now());
select throws_ok($t$select public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'55000','settlement unavailable','refund blocks even previously prepared settlement');
rollback to savepoint settlement_fixture;
savepoint settlement_dispatch_fixture;
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'123',md5('fiscal-payment')::uuid,'succeeded',true)
 on conflict(order_id) do update set status='succeeded',paid=true,payment_id=md5('fiscal-payment')::uuid,requires_review=false;
set local role authenticated;
select throws_ok($t$select public.claim_prepayment_settlement(current_setting('test.payment')::uuid)$t$,'42501',null,'browser cannot claim settlement');
select throws_ok($t$select public.record_prepayment_settlement(current_setting('test.payment')::uuid,'rt-test','succeeded')$t$,'42501',null,'browser cannot forge settlement result');
set local role service_role;
select is(public.claim_prepayment_settlement(current_setting('test.payment')::uuid)->>'action','send','first claim permits one dispatch');
select is(public.claim_prepayment_settlement(current_setting('test.payment')::uuid)->>'action','reconcile','unknown outcome cannot dispatch again');
select is(jsonb_array_length(public.list_pending_prepayment_settlements('123')),1,'claimed unknown settlement is eligible');
select public.record_settlement_poll(current_setting('test.payment')::uuid,false);
select is(jsonb_array_length(public.list_pending_prepayment_settlements('123')),0,'unresolved settlement waits before retry');
reset role;
select is((select poll_failures from public.billing_prepayment_settlement_status where order_id=current_setting('test.payment')::uuid),1,'unresolved poll counted');
update public.billing_prepayment_settlement_status set next_check_at=now()-interval '1 second';
set local role service_role;
select is(jsonb_array_length(public.list_pending_prepayment_settlements('123')),1,'settlement becomes due again');
select public.record_settlement_poll(current_setting('test.payment')::uuid,false);
reset role;
select ok((select next_check_at-last_polled_at between interval '119 seconds' and interval '121 seconds' from public.billing_prepayment_settlement_status where order_id=current_setting('test.payment')::uuid),'second poll waits two minutes');
select public.record_settlement_poll(current_setting('test.payment')::uuid,true);
select is((select poll_failures from public.billing_prepayment_settlement_status where order_id=current_setting('test.payment')::uuid),0,'verified receipt resets retry delay');
set local role authenticated;
select throws_ok($t$select public.record_settlement_poll(current_setting('test.payment')::uuid,true)$t$,'42501',null,'browser cannot change poll schedule');
set local role service_role;

select is(jsonb_array_length(public.list_pending_prepayment_settlements('999')),0,'settlement batch is shop scoped');
select throws_ok($t$select public.list_pending_prepayment_settlements('123',101)$t$,'22023','invalid settlement batch','settlement batch bounded');
set local role authenticated;
select throws_ok($t$select public.list_pending_prepayment_settlements('123')$t$,'42501',null,'browser cannot enumerate settlements');
set local role service_role;

select throws_ok('select * from public.billing_prepayment_settlement_status','42501',null,'raw settlement status closed');
select public.record_prepayment_settlement(current_setting('test.payment')::uuid,'rt-test','pending');
select public.record_prepayment_settlement(current_setting('test.payment')::uuid,'rt-test','succeeded');
select public.record_prepayment_settlement(current_setting('test.payment')::uuid,'rt-test','pending');
select is(public.claim_prepayment_settlement(current_setting('test.payment')::uuid)->>'status','succeeded','late pending does not regress final result');
select is(public.claim_prepayment_settlement(current_setting('test.payment')::uuid)->>'receiptId','rt-test','known receipt available for GET recovery');
select public.record_prepayment_settlement(current_setting('test.payment')::uuid,'rt-other','succeeded');
reset role;
select ok((select requires_review from public.billing_prepayment_settlement_status where order_id=current_setting('test.payment')::uuid),'conflicting receipt requires review');
set local role authenticated;
select set_config('test.settlement.admin',public.read_platform_order_receipts(current_setting('test.org')::uuid,current_setting('test.payment')::uuid)::text,true);
select ok(exists(select 1 from jsonb_array_elements(current_setting('test.settlement.admin')::jsonb->'items') x where x->>'kind'='settlement' and (x->>'needsAttention')::boolean),'admin sees settlement conflict even with succeeded status');
select ok(position('receipt@example.test' in current_setting('test.settlement.admin'))=0,'settlement status excludes email');
select throws_ok($t$select public.read_platform_order_receipts(gen_random_uuid(),current_setting('test.payment')::uuid)$t$,'42501',null,'settlement cannot be read through another workspace');
reset role;

select is(jsonb_array_length(public.list_pending_prepayment_settlements('123')),0,'terminal or flagged settlement excluded');
select throws_ok($t$insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,first_sent_at)
 values(md5('after-settlement-refund')::uuid,current_setting('test.payment')::uuid,auth.uid(),md5('after-settlement-refund-command')::uuid,1000,md5('fiscal-payment')::uuid,'sending',now())$t$,'55000','refund after settlement requires review','refund cannot race a claimed settlement');
rollback to savepoint settlement_dispatch_fixture;
insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,first_sent_at)
 values(md5('receipt-full-refund')::uuid,current_setting('test.payment')::uuid,auth.uid(),md5('receipt-refund-command')::uuid,6172,md5('fiscal-payment')::uuid,'sending',now()),
 (md5('receipt-partial-refund')::uuid,current_setting('test.payment')::uuid,auth.uid(),md5('receipt-partial-command')::uuid,1000,md5('fiscal-payment')::uuid,'sending',now());
set local role authenticated;
select throws_ok($t$select public.prepare_refund_receipt_request(md5('receipt-full-refund')::uuid)$t$,'42501',null,'browser cannot prepare refund receipt');
set local role service_role;
select set_config('test.refund.receipt',public.prepare_refund_receipt_request(md5('receipt-full-refund')::uuid)::text,true);
select is(current_setting('test.refund.receipt')::jsonb#>>'{amount,value}','61.72','full refund uses original charged amount');
select ok(not(current_setting('test.refund.receipt')::jsonb?'receipt'),'full refund omits receipt per provider contract');
select is(public.prepare_refund_receipt_request(md5('receipt-full-refund')::uuid)::text,current_setting('test.refund.receipt'),'full refund retry immutable');
select throws_ok($t$select public.prepare_refund_receipt_request(md5('receipt-partial-refund')::uuid)$t$,'55000','partial refund receipt required','partial refund cannot bypass item preparation');
select public.record_refund_receipt_status(md5('receipt-full-refund')::uuid,md5('provider-refund')::uuid,'succeeded');
select public.record_refund_receipt_status(md5('receipt-full-refund')::uuid,md5('provider-refund')::uuid,'pending');
select throws_ok('select * from public.billing_refund_receipt_requests','42501',null,'raw refund request inaccessible');
reset role;
select is((select status from public.billing_refund_receipt_status where refund_id=md5('receipt-full-refund')::uuid),'succeeded','registered refund receipt cannot regress');
set local role authenticated;
select throws_ok('select public.list_pending_refund_receipts()','42501',null,'browser cannot enumerate refund receipts');
set local role service_role;
select is(jsonb_array_length(public.list_pending_refund_receipts(25,'123')),0,'registered refund receipt excluded from polling');
reset role;
reset role;
insert into public.billing_refund_receipt_requests(refund_id,body,created_at) values(md5('receipt-partial-refund')::uuid,'{}'::jsonb,now()-interval '4 days');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
select set_config('test.admin.receipts',public.read_platform_order_receipts(current_setting('test.org')::uuid,current_setting('test.payment')::uuid)::text,true);
select is(jsonb_array_length(current_setting('test.admin.receipts')::jsonb->'items'),3,'payment and both refund receipts listed');
select ok(exists(select 1 from jsonb_array_elements(current_setting('test.admin.receipts')::jsonb->'items') x where x->>'status'='unknown' and (x->>'needsAttention')::boolean),'old unknown result needs attention');
select ok(position('receipt@example.test' in current_setting('test.admin.receipts'))=0,'admin status does not expose email');
select throws_ok($t$select public.read_platform_order_receipts(gen_random_uuid(),current_setting('test.payment')::uuid)$t$,'42501',null,'wrong workspace denied');
reset role;
select set_config('request.jwt.claim.sub',md5('receipt-other-user')::uuid::text,true);
set local role authenticated;
select throws_ok($t$select public.read_platform_order_receipts(current_setting('test.org')::uuid,current_setting('test.payment')::uuid)$t$,'42501',null,'nonstaff cannot read fiscal status');
reset role;
reset role;
select public.record_refund_receipt_status(md5('receipt-partial-refund')::uuid,md5('provider-partial-refund')::uuid,'pending');
set local role authenticated;
select throws_ok($t$select public.record_receipt_poll('refund',md5('receipt-partial-refund')::uuid,false)$t$,'42501',null,'browser cannot control receipt polling');
set local role service_role;
select is(jsonb_array_length(public.list_pending_refund_receipts(25,'123')),1,'pending receipt initially due');
select public.record_receipt_poll('refund',md5('receipt-partial-refund')::uuid,false);
select is(jsonb_array_length(public.list_pending_refund_receipts(25,'123')),0,'failed receipt waits before retry');
select throws_ok($t$select public.record_receipt_poll('payment',md5('receipt-partial-refund')::uuid,false)$t$,'22023','receipt request unavailable','cannot confuse operation kinds');
reset role;
select is((select consecutive_failures from public.billing_receipt_poll_schedule where operation_id=md5('receipt-partial-refund')::uuid),1,'first failure counted');
update public.billing_receipt_poll_schedule set next_check_at=now()-interval '1 second';
set local role service_role;
select is(jsonb_array_length(public.list_pending_refund_receipts(25,'123')),1,'receipt becomes eligible after delay');
select public.record_receipt_poll('refund',md5('receipt-partial-refund')::uuid,false);
reset role;
select is((select extract(epoch from next_check_at-checked_at)::integer from public.billing_receipt_poll_schedule where operation_id=md5('receipt-partial-refund')::uuid),120,'second failure doubles delay');
select public.record_receipt_poll('refund',md5('receipt-partial-refund')::uuid,true);
select is((select consecutive_failures from public.billing_receipt_poll_schedule where operation_id=md5('receipt-partial-refund')::uuid),0,'successful read resets failure count');
