begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),5000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);


select set_config('test.quote',public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'TEST-CODE')::text,true);
select throws_ok($t$select public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('public-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb)$t$,'42501','sandbox organization required','вне sandbox-области покупка закрыта');
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.accepted',public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('public-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb)::text,true);
select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select is(public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('public-command')::uuid)->>'order_id',current_setting('test.order'),'публичное подтверждение восстанавливается');
savepoint revoked_scope;
delete from public.billing_sandbox_application_scope where organization_id=current_setting('test.org')::uuid;
select throws_ok($t$select public.execute_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid)$t$,'42501','sandbox organization required','исполнение повторно проверяет область');
rollback to revoked_scope;

select set_config('test.execution',public.execute_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid)::text,true);
select is(current_setting('test.execution')::jsonb->>'requires_payment','true','положительная сумма требует платежа');
select is(public.execute_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),current_setting('test.execution')::jsonb,'повтор подготовки возвращает тот же платёж');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),1::bigint,'платёжный заказ один');
select is((select amount_minor from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),6172::bigint,'платёж на серверную сумму после скидки');
select is((select first_sent_at from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),null::timestamptz,'подготовка не отправляет платёж');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'подготовка не выдаёт платный доступ');
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','подготовленный заказ можно отменить до отправки');
select * from finish();rollback;
