-- Included in the disposable full-schema transaction with modeled paid checkout.
reset role;
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'123',md5('fiscal-payment')::uuid,'succeeded',true)
 on conflict(order_id) do update set status='succeeded',paid=true,payment_id=md5('fiscal-payment')::uuid,requires_review=false;
-- Advance only this synthetic immutable term in the disposable test DB.
alter table public.billing_subscription_fiscal_terms disable trigger subscription_fiscal_terms_immutable;
update public.billing_subscription_fiscal_terms set period_start=now()-interval '1 month',period_end=now();
alter table public.billing_subscription_fiscal_terms enable trigger subscription_fiscal_terms_immutable;
select ok((select relrowsecurity from pg_class where oid='public.billing_subscription_fiscal_ledgers'::regclass),'ledger RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.billing_subscription_fiscal_operations'::regclass),'operation RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.billing_subscription_fiscal_operation_status'::regclass),'operation status RLS enabled');
set local role anon;
select throws_ok($$select * from public.billing_subscription_fiscal_ledgers$$,'42501',null,'anon ledger denied');
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(null,null,0,'refund',100)$$,'42501',null,'anon reserve denied');
reset role;
set local role authenticated;
select throws_ok($$select * from public.billing_subscription_fiscal_operations$$,'42501',null,'browser raw fiscal body denied');
select throws_ok($$insert into public.billing_subscription_fiscal_operation_status(command_id) values(md5('x')::uuid)$$,'42501',null,'browser status forgery denied');
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(null,null,0,'refund',100)$$,'42501',null,'browser reserve denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.billing_subscription_fiscal_operations$$,'42501',null,'service raw fiscal body denied');
select throws_ok($$update public.billing_subscription_fiscal_ledgers set version=0$$,'42501',null,'service version forgery denied');
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(null,null,0,'refund',100)$$,'42501',null,'unintegrated service reserve denied');
reset role;
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('invalid')::uuid,0,'refund',99)$$,'22023','fiscal refund limits','provider minimum preserved');
select is((select count(*) from public.billing_subscription_fiscal_ledgers),0::bigint,'failed reservation rolls back new ledger');
select set_config('test.ledger.first',platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('ledger-first')::uuid,0,'refund',1000)::text,true);
select is(current_setting('test.ledger.first')::jsonb->>'kind','refund_before','before settlement mode selected');
select is(current_setting('test.ledger.first')::jsonb#>>'{body,receipt,items,0,amount,value}','61.72','original unit price preserved');
select is(current_setting('test.ledger.first')::jsonb#>>'{body,receipt,items,0,quantity}','0.162022','six decimal quantity computed');
select is((select version from public.billing_subscription_fiscal_ledgers),1::bigint,'reserve increments version atomically');
select is(platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('ledger-first')::uuid,0,'refund',1000)::text,current_setting('test.ledger.first'),'same command returns exact immutable request');
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('ledger-first')::uuid,0,'refund',1001)$$,'22023','fiscal command conflict','changed command rejected');
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('stale')::uuid,0,'refund',1000)$$,'55000','fiscal version changed','stale version rejected');
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('blocked')::uuid,1,'settlement',5172)$$,'55000','fiscal operation unresolved','reservation blocks settlement');
select throws_ok($$update public.billing_subscription_fiscal_operations set body='{}'$$,'55000','fiscal record immutable','request cannot change');
select throws_ok($$truncate public.billing_subscription_fiscal_operations cascade$$,'55000','fiscal record immutable','request truncate denied');
select throws_ok($$select public.prepare_prepayment_settlement(current_setting('test.payment')::uuid)$$,'55000','fiscal ledger owns order','legacy settlement cannot bypass reserve');
select throws_ok($$insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id)
 select id,actor_id,md5('legacy-attempt')::uuid,1000,md5('fiscal-payment')::uuid from public.billing_sandbox_orders where id=current_setting('test.payment')::uuid$$,
 '55000','fiscal ledger owns order','legacy refund cannot bypass reserve');
-- Result recording is not exposed yet; privileged synthetic updates model its inputs.
update public.billing_subscription_fiscal_operation_status set state='unknown' where command_id=md5('ledger-first')::uuid;
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('blocked')::uuid,1,'refund',1000)$$,'55000','fiscal operation unresolved','unknown refund keeps reservation');
update public.billing_subscription_fiscal_operation_status set state='succeeded',receipt_status='pending' where command_id=md5('ledger-first')::uuid;
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('blocked')::uuid,1,'settlement',5172)$$,'55000','fiscal operation unresolved','unconfirmed refund receipt blocks next operation');
update public.billing_subscription_fiscal_operation_status set receipt_status='succeeded' where command_id=md5('ledger-first')::uuid;
select set_config('test.ledger.settle',platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('ledger-settle')::uuid,1,'settlement',5172)::text,true);
select is(current_setting('test.ledger.settle')::jsonb#>>'{body,settlements,0,amount,value}','51.72','only remainder is settled');
select is(current_setting('test.ledger.settle')::jsonb#>>'{body,items,0,quantity}','0.837978','settlement uses remaining quantity');
update public.billing_subscription_fiscal_operation_status set state='succeeded',receipt_status='succeeded' where command_id=md5('ledger-settle')::uuid;
select set_config('test.ledger.last',platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('ledger-last')::uuid,2,'refund',5172)::text,true);
select is(current_setting('test.ledger.last')::jsonb->>'kind','refund_after','refund after settlement selected');
select is(current_setting('test.ledger.last')::jsonb#>>'{body,receipt,items,0,payment_mode}','full_payment','final refund uses full payment');
update public.billing_subscription_fiscal_operation_status set state='succeeded',receipt_status='succeeded' where command_id=md5('ledger-last')::uuid;
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('over')::uuid,3,'refund',100)$$,'55000','fiscal amount unavailable','fully returned payment cannot refund again');
select is((select sum(quantity_units) from public.billing_subscription_fiscal_operations where kind<>'settlement'),1000000::numeric,'refunded quantity equals original');
select is((select version from public.billing_subscription_fiscal_ledgers),3::bigint,'only successful reserves consume version');
-- Exercise RLS itself, separately from the default privilege denial.
grant select on public.billing_subscription_fiscal_ledgers,public.billing_subscription_fiscal_operations,public.billing_subscription_fiscal_operation_status to authenticated,anon;
set local role authenticated;
select is((select count(*) from public.billing_subscription_fiscal_operations),0::bigint,'RLS hides fiscal bodies even with temporary SELECT grant');
select is((select count(*) from public.billing_subscription_fiscal_ledgers),0::bigint,'RLS hides ledger rows from browser');
select is((select count(*) from public.billing_subscription_fiscal_operation_status),0::bigint,'RLS hides operation statuses from browser');
reset role;
set local role anon;
select is((select count(*) from public.billing_subscription_fiscal_operations),0::bigint,'RLS hides fiscal bodies from anonymous role');
reset role;
revoke select on public.billing_subscription_fiscal_ledgers,public.billing_subscription_fiscal_operations,public.billing_subscription_fiscal_operation_status from authenticated,anon;
select jsonb_build_object('fiscalParity',jsonb_build_array(current_setting('test.ledger.first')::jsonb->'body',current_setting('test.ledger.settle')::jsonb->'body',current_setting('test.ledger.last')::jsonb->'body'))::text;
