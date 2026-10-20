-- Run inside the isolated full-refund fixture before its first reserve.
savepoint legacy_full_refund;
insert into public.billing_subscription_fiscal_ledgers(order_id,payment_id,amount_minor,version)
values(current_setting('test.order')::uuid,md5('trial-refund-payment')::uuid,99000,1);
insert into public.billing_subscription_fiscal_operations(command_id,order_id,expected_version,kind,amount_minor,quantity_units,body,body_sha256)
select current_setting('test.request')::uuid,current_setting('test.order')::uuid,0,'refund_before',99000,1000000,b,
 encode(extensions.digest(convert_to(b::text,'UTF8'),'sha256'),'hex')
from (select jsonb_build_object('payment_id',md5('trial-refund-payment')::uuid,'amount',jsonb_build_object('value','990.00','currency','RUB'),
 'receipt',body->'receipt') b from public.billing_receipt_payment_requests where order_id=current_setting('test.order')::uuid) q;
insert into public.billing_subscription_fiscal_operation_status(command_id) values(current_setting('test.request')::uuid);
select set_config('test.legacy.immutable',(select to_jsonb(x)::text from public.billing_subscription_fiscal_operations x where command_id=current_setting('test.request')::uuid),true);
select ok(platform_private.reserve_subscription_fiscal_operation(current_setting('test.order')::uuid,current_setting('test.request')::uuid,0,'refund',99000)->'body' ? 'receipt','historical full refund keeps receipt on reserve retry');
select set_config('test.legacy.claim',platform_private.claim_subscription_fiscal_operation(current_setting('test.request')::uuid)::text,true);
select is(current_setting('test.legacy.claim')::jsonb->'expectedItems',current_setting('test.legacy.claim')::jsonb#>'{body,receipt,items}','historical expected items come from saved body');
select is(platform_private.claim_subscription_fiscal_operation(current_setting('test.request')::uuid)->>'action','reconcile','historical full refund retry reconciles');
select is((select to_jsonb(x)::text from public.billing_subscription_fiscal_operations x where command_id=current_setting('test.request')::uuid),current_setting('test.legacy.immutable'),'historical body hash key and entire row remain unchanged');
rollback to legacy_full_refund;
select ok(not has_function_privilege('anon','platform_private.subscription_fiscal_expected_items(uuid)','execute'),'anon cannot read expected fiscal items');
select ok(not has_function_privilege('authenticated','platform_private.subscription_fiscal_expected_items(uuid)','execute'),'client cannot read expected fiscal items');
select ok(not has_function_privilege('service_role','platform_private.subscription_fiscal_expected_items(uuid)','execute'),'service role has no direct expected-items access');
select ok((select relrowsecurity from pg_class where oid='public.billing_subscription_fiscal_operations'::regclass),'operation RLS remains enabled');
select ok(not has_table_privilege('authenticated','public.billing_subscription_fiscal_operations','SELECT,INSERT,UPDATE,DELETE'),'client operation table access remains denied');