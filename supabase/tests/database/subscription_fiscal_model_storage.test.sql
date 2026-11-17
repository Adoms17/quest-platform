begin;
select no_plan();
-- Existing receipts must survive the additive migration without a model/backfill.
select is((select count(*) from public.billing_fiscal_policy_models),0::bigint,'no active models seeded');
select is((select count(*) from public.billing_subscription_fiscal_terms),0::bigint,'no historical terms inferred');
select is((select to_jsonb(s)::text from public.billing_receipt_snapshots s),(select body from legacy_snapshot),'legacy snapshot unchanged');
select ok((select relrowsecurity from pg_class where oid='public.billing_fiscal_policy_models'::regclass),'model RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.billing_subscription_fiscal_terms'::regclass),'terms RLS enabled');
select throws_ok($$insert into public.billing_fiscal_policy_models values('22222222-2222-4222-8222-222222222222','subscription','subscription_access_v1','ausn','period_end',now())$$,'22023','subscription fiscal policy incompatible','cannot classify an effective historical policy');
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values('33333333-3333-4333-8333-333333333333','sandbox','123',clock_timestamp()+interval '1 day',2,'service','full_prepayment'),
 ('44444444-4444-4444-8444-444444444444','sandbox','123',clock_timestamp()+interval '2 days',1,'property_right','full_prepayment'),
 ('55555555-5555-4555-8555-555555555555','sandbox','123',clock_timestamp()+interval '3 days',1,'service','full_payment');
select throws_ok($$insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis) values('33333333-3333-4333-8333-333333333333','subscription','subscription_access_v1','ausn','period_end')$$,'22023','subscription fiscal policy incompatible','VAT zero is not without VAT');
select throws_ok($$insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis) values('44444444-4444-4444-8444-444444444444','subscription','subscription_access_v1','ausn','period_end')$$,'22023','subscription fiscal policy incompatible','rights policy cannot be subscription service');
select throws_ok($$insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis) values('55555555-5555-4555-8555-555555555555','subscription','subscription_access_v1','ausn','period_end')$$,'22023','subscription fiscal policy incompatible','payment must be prepayment');
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values('66666666-6666-4666-8666-666666666666','sandbox','123',clock_timestamp()+interval '2 seconds',1,'service','full_prepayment');
select throws_ok($$insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis) values('66666666-6666-4666-8666-666666666666','quest_template','subscription_access_v1','ausn','period_end')$$,'23514',null,'template cannot use subscription model');
select lives_ok($$insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis) values('66666666-6666-4666-8666-666666666666','subscription','subscription_access_v1','ausn','period_end')$$,'new future model accepted');
select throws_ok($$update public.billing_fiscal_policy_models set seller_tax_regime='ausn'$$,'55000','fiscal record immutable','model immutable');
select throws_ok($$delete from public.billing_fiscal_policy_models$$,'55000','fiscal record immutable','model deletion forbidden');
select pg_sleep(2.1);
insert into public.billing_sandbox_orders(id,shop_id,amount_minor,currency,state,period_start,period_end)
 values('77777777-7777-4777-8777-777777777777','123',99000,'RUB','reserved','2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
insert into public.billing_receipt_snapshots(order_id,policy_id,email,description)
 values('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','buyer@example.test','Subscription');
select throws_ok($$insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222')$$,'22023','subscription fiscal snapshot mismatch','other policy rejected');
select lives_ok($$insert into public.billing_subscription_fiscal_terms(order_id,policy_id,period_start,period_end) values('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','2000-01-01','2001-01-01')$$,'terms derived from order');
select is((select period_start from public.billing_subscription_fiscal_terms),'2026-10-01T00:00:00Z'::timestamptz,'start cannot be supplied by caller');
select is((select period_end from public.billing_subscription_fiscal_terms),'2026-11-01T00:00:00Z'::timestamptz,'end cannot be supplied by caller');
select throws_ok($$insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666')$$,'23505',null,'duplicate terms rejected');
select throws_ok($$update public.billing_subscription_fiscal_terms set period_end=period_end+interval '1 month'$$,'55000','fiscal record immutable','terms immutable');
select throws_ok($$delete from public.billing_subscription_fiscal_terms$$,'55000','fiscal record immutable','terms cannot be deleted');
update public.billing_sandbox_orders set first_sent_at=now(),state='sending' where id='77777777-7777-4777-8777-777777777777';
select throws_ok($$insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666')$$,'55000','fiscal terms must precede payment send','no terms preparation after send');
set local role anon;
select throws_ok($$select * from public.billing_fiscal_policy_models$$,'42501',null,'anon model read denied');
select throws_ok($$select * from public.billing_subscription_fiscal_terms$$,'42501',null,'anon terms read denied');
reset role;
set local role authenticated;
select throws_ok($$select * from public.billing_fiscal_policy_models$$,'42501',null,'authenticated model read denied');
select throws_ok($$select * from public.billing_subscription_fiscal_terms$$,'42501',null,'authenticated terms read denied');
select throws_ok($$insert into public.billing_fiscal_policy_models default values$$,'42501',null,'authenticated model write denied');
select throws_ok($$insert into public.billing_subscription_fiscal_terms default values$$,'42501',null,'authenticated terms write denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.billing_subscription_fiscal_terms$$,'42501',null,'service role direct terms read denied');
select throws_ok($$insert into public.billing_fiscal_policy_models default values$$,'42501',null,'service role model write denied');
select throws_ok($$insert into public.billing_subscription_fiscal_terms default values$$,'42501',null,'service role terms write denied');
reset role;
insert into public.billing_sandbox_orders(id,shop_id,amount_minor,currency,state,period_start,period_end)
 values('88888888-8888-4888-8888-888888888888','123',100,'RUB','reserved','2026-11-01','2026-10-01');
select throws_ok($$do $body$ begin
 insert into public.billing_receipt_snapshots(order_id,policy_id,email,description) values('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666','buyer@example.test','Invalid period');
 insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666');
end $body$; $$,'23514',null,'inverted order period rejected');
select is((select count(*) from public.billing_receipt_snapshots where order_id='88888888-8888-4888-8888-888888888888'),0::bigint,'failed terms roll back snapshot in same transaction');
update public.billing_sandbox_orders set period_start='2026-10-01',period_end='infinity' where id='88888888-8888-4888-8888-888888888888';
insert into public.billing_receipt_snapshots(order_id,policy_id,email,description) values('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666','buyer@example.test','Invalid period');
select throws_ok($$insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666')$$,'23514',null,'infinite period rejected');
select throws_ok($$insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')$$,'23503',null,'legacy snapshot cannot get terms without a model');
select is((select count(*) from public.billing_subscription_fiscal_terms),1::bigint,'failed commands do not create terms');
select * from finish();
rollback;
