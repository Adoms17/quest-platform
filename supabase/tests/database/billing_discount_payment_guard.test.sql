begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),5000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);

select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select throws_ok($t$select platform_private.fulfill_zero_discount_checkout(current_setting('test.order')::uuid)$t$,'55000','discount checkout requires verified payment','положительная сумма требует проверенную оплату');
select is((select state from public.billing_discount_checkout_states where order_id=current_setting('test.order')::uuid),'ready','обход оплаты не начинает исполнение');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'reserved','обход оплаты не расходует скидку');
select is((select count(*) from public.billing_discount_fulfillments where order_id=current_setting('test.order')::uuid),0::bigint,'подтверждение не создано');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'подписка не меняется');
select * from finish();rollback;
