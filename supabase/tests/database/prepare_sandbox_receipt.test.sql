begin;
select plan(10);
select set_config('test.actor','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select set_config('test.workspace','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
insert into public.billing_sandbox_orders(id,actor_id,organization_id,shop_id,amount_minor,currency,state,period_start,period_end)
 values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','123',100,'RUB','reserved',now(),now()+interval '1 month');
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values('22222222-2222-4222-8222-222222222222','sandbox','123',now()-interval '1 hour',1,'service','full_prepayment');
set local role authenticated;
select throws_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111',null)$$,'22023','invalid receipt email','email required');
select lives_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','buyer@example.com')$$,'prepare allowed');
select lives_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','buyer@example.com')$$,'repeat allowed');
select throws_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','changed@example.com')$$,'22023','receipt command conflict','changed repeat rejected');
reset role;
select is((select count(*) from public.billing_receipt_audit),1::bigint,'one audit event');
select is((select count(*) from public.billing_receipt_snapshots),1::bigint,'one snapshot');
select set_config('test.workspace','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
set local role authenticated;
select throws_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','buyer@example.com')$$,'42501','receipt access denied','revoked workspace permission denied on retry');
select set_config('test.workspace','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select set_config('test.actor','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
select throws_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','buyer@example.com')$$,'42501','receipt access denied','other buyer denied');
select throws_ok($$select * from public.billing_receipt_audit$$,'42501',null,'direct audit access denied');
reset role;
set local role anon;
select throws_ok($$select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','buyer@example.com')$$,'42501',null,'anonymous denied');
reset role;
select * from finish();
rollback;
