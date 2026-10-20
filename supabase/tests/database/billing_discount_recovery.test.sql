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

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select is(public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('accept-command')::uuid)->>'order_id',current_setting('test.order'),'потерянный ответ восстанавливается без кода');
select is(public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,gen_random_uuid()),null::jsonb,'неизвестная команда не подменяется другим заказом');
select ok(not (public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('accept-command')::uuid) ? 'code_hash'),'хэш не возвращается');
select is(public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('accept-command')::uuid)->>'state','ready','восстановлено текущее состояние');
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','отмена нулевого заказа до исполнения');
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','отмена идемпотентна');
select is(public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('accept-command')::uuid)->>'reservation_state','released','восстановление показывает освобождённую льготу');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),0::bigint,'отмена не меняет подписку');
select ok(has_function_privilege('authenticated','public.recover_sandbox_discount_checkout(uuid,uuid)','execute'),'авторизованному клиенту доступно восстановление');
select ok(not has_function_privilege('anon','public.cancel_sandbox_discount_checkout(uuid,uuid)','execute'),'анонимная отмена закрыта');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($t$select public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('accept-command')::uuid)$t$,'42501','billing management denied','чужой аккаунт не восстанавливает заказ');
select throws_ok($t$select public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid)$t$,'42501','billing management denied','чужой аккаунт не отменяет заказ');
select * from finish();rollback;
