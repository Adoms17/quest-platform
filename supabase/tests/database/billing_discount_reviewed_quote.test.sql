begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);


select set_config('test.quote',public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'TEST-CODE')::text,true);
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb||'{"amount_minor":1}'::jsonb)->>'reason','quote_changed','подменённая сумма не принимается');
select is((select count(*) from public.billing_discount_checkouts where organization_id=current_setting('test.org')::uuid),0::bigint,'отказ не оставляет checkout');
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid),0::bigint,'отказ не оставляет резерв');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb||'{"remaining_periods":99}'::jsonb)->>'reason','quote_changed','нельзя подтвердить другое число льготных периодов');
select throws_ok($t$select platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE','{}')$t$,'22023','invalid reviewed quote','пустой расчёт отклоняется');
select set_config('test.accepted',platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb)::text,true);
select is(current_setting('test.accepted')::jsonb->>'reserved','true','согласованный расчёт резервируется');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb),current_setting('test.accepted')::jsonb,'потерянный ответ восстанавливается повтором');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb||'{"amount_minor":1}'::jsonb)->>'reason','quote_changed','retry с другим расчётом не подтверждается');
select is((select count(*) from public.billing_discount_checkouts where organization_id=current_setting('test.org')::uuid),1::bigint,'retry сохраняет единственный заказ');
select is((select state from public.billing_discount_reservations where order_id=(current_setting('test.accepted')::jsonb->>'order_id')::uuid),'reserved','неверный retry не снимает прежний резерв');
select is(platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,gen_random_uuid(),'WRONG',current_setting('test.quote')::jsonb)->>'reason','invalid_code','отказ кода остаётся безопасным');
select ok((select attempts>=2 from public.billing_discount_checks where actor_id=auth.uid()),'счётчик неудачной проверки кода сохранён');
select ok(not has_function_privilege('authenticated','platform_private.accept_reviewed_discount_checkout(uuid,uuid,uuid,text,jsonb)','execute'),'адаптер пока закрыт браузеру');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($t$select platform_private.accept_reviewed_discount_checkout(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('review-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb)$t$,'42501','billing management denied','чужой аккаунт не восстанавливает заказ');
select * from finish();rollback;
