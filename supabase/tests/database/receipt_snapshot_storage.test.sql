begin;
select plan(12);
insert into public.billing_sandbox_orders(id,shop_id,amount_minor,currency,state) values('11111111-1111-4111-8111-111111111111','123',12345,'RUB','reserved');
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values('22222222-2222-4222-8222-222222222222','sandbox','123',now()-interval '1 hour',1,'service','full_prepayment');
select lives_ok($$insert into public.billing_receipt_snapshots(order_id,policy_id,email,description,amount_minor,vat_code)
 values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','buyer@example.com','Test subscription',9,12)$$,'snapshot created');
select is((select amount_minor from public.billing_receipt_snapshots),12345::bigint,'amount derived from order');
select is((select vat_code from public.billing_receipt_snapshots),1,'VAT derived from policy');
select throws_ok($$update public.billing_receipt_snapshots set email='other@example.com'$$,'55000','fiscal record immutable','snapshot immutable');
select throws_ok($$delete from public.billing_fiscal_policies$$,'55000','fiscal record immutable','policy immutable');
select ok((select relrowsecurity from pg_class where oid='public.billing_receipt_snapshots'::regclass),'snapshot RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.billing_fiscal_policies'::regclass),'policy RLS enabled');
set local role authenticated;
select throws_ok($$select * from public.billing_receipt_snapshots$$,'42501',null,'client cannot read contact');
select throws_ok($$insert into public.billing_fiscal_policies default values$$,'42501',null,'client cannot set policy');
reset role;
set local role service_role;
select throws_ok($$select * from public.billing_receipt_snapshots$$,'42501',null,'service role cannot read directly');
reset role;
insert into public.billing_sandbox_orders(id,shop_id,amount_minor,currency,state,first_sent_at) values('33333333-3333-4333-8333-333333333333','123',100,'RUB','sending',now());
select throws_ok($$insert into public.billing_receipt_snapshots(order_id,policy_id,email,description) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','buyer@example.com','Test')$$,'55000','receipt must precede payment send','no retroactive snapshot');
insert into public.billing_sandbox_orders(id,shop_id,amount_minor,currency,state) values('44444444-4444-4444-8444-444444444444','456',100,'RUB','reserved');
select throws_ok($$insert into public.billing_receipt_snapshots(order_id,policy_id,email,description) values('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','buyer@example.com','Test')$$,'22023','receipt policy unavailable','other shop rejected');
select * from finish();
rollback;
