begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);


select set_config('test.quote',public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'')::text,true);
select throws_ok($t$select public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('public-command')::uuid,'',current_setting('test.quote')::jsonb)$t$,'42501','sandbox organization required','вне sandbox-области покупка закрыта');
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.accepted',public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('public-command')::uuid,'',current_setting('test.quote')::jsonb)::text,true);
select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select is(public.recover_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('public-command')::uuid)->>'order_id',current_setting('test.order'),'публичное подтверждение восстанавливается');
select is(current_setting('test.accepted')::jsonb->>'amount_minor','12345','без кода полная цена');
select is((select discount_id from public.billing_discount_reservations where order_id=current_setting('test.order')::uuid),null::uuid,'без привязки к скидке');
select is((select count(*) from public.billing_discount_checks),0::bigint,'пустой код не расходует проверки промокодов');
select is(public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('public-command')::uuid,'',current_setting('test.quote')::jsonb)->>'order_id',current_setting('test.order'),'повтор возвращает тот же заказ');
select throws_ok($t$select public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('public-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb)$t$,'22023','discount checkout conflict','код нельзя добавить к уже принятой команде');
select is(public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('second-command')::uuid,'',current_setting('test.quote')::jsonb)->>'reason','checkout_pending','второй ожидающий заказ запрещён');
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','отмена до исполнения');
select is(public.cancel_sandbox_discount_checkout(current_setting('test.org')::uuid,current_setting('test.order')::uuid),'cancelled','повтор отмены безопасен');
select is(public.accept_sandbox_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('tampered-command')::uuid,'',current_setting('test.quote')::jsonb||jsonb_build_object('amount_minor',1))->>'reason','quote_changed','клиент не снижает цену');
select is((select count(*) from public.billing_discount_checkouts),1::bigint,'изменённый расчёт не создаёт заказ');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($t$select public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'')$t$,'42501','billing management denied','чужая организация недоступна');
set local role authenticated;
select throws_ok('select * from public.billing_discount_reservations','42501',null,'прямой доступ к резервам закрыт');
reset role;
select * from finish();rollback;