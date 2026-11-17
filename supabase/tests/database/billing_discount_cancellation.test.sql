begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);

select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')::text,true);

select set_config('test.order',(current_setting('test.accepted')::jsonb->>'order_id'),true);
select is(platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','отмена до исполнения');
select is(platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','retry отмены безопасен');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),'released','отмена освобождает скидку');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')->>'status','cancelled','retry покупки сообщает отмену');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('accept-command')::uuid,'TEST-CODE')->>'reserved','false','retry не показывает освобождённый резерв активным');
select throws_ok($t$select platform_private.begin_discount_checkout_execution(current_setting('test.order')::uuid)$t$,'55000','discount checkout not executable','отменённый заказ нельзя исполнить');
select set_config('test.next',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('next-command')::uuid,'TEST-CODE')::text,true);
select ok((current_setting('test.next')::jsonb->>'reserved')::boolean,'после отмены можно создать новый заказ');
select set_config('test.next_order',current_setting('test.next')::jsonb->>'order_id',true);
select is(platform_private.begin_discount_checkout_execution(current_setting('test.next_order')::uuid),'executing','начало исполнения фиксируется');
select is(platform_private.begin_discount_checkout_execution(current_setting('test.next_order')::uuid),'executing','retry начала не создаёт другое исполнение');
select throws_ok($t$select platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,current_setting('test.next_order')::uuid)$t$,'55000','discount checkout requires reconciliation','после начала нужна сверка вместо освобождения скидки');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.next_order')::uuid),'reserved','отклонённая отмена сохраняет резерв');
select is(platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('next-command')::uuid,'TEST-CODE')->>'status','executing','retry показывает начатое исполнение');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'отмена и маркер исполнения не меняют подписку');
select ok((select relrowsecurity from pg_class where oid='public.billing_discount_checkout_states'::regclass),'RLS состояний включён');
select ok(not has_function_privilege('authenticated','platform_private.cancel_discount_checkout(uuid,uuid)','execute'),'внутренний шаг закрыт клиенту');
select ok(not has_function_privilege('service_role','platform_private.begin_discount_checkout_execution(uuid)','execute'),'прямой RPC начала исполнения закрыт');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($t$select platform_private.cancel_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid)$t$,'42501','billing management denied','чужой пользователь не отменяет заказ');
select * from finish();
rollback;
