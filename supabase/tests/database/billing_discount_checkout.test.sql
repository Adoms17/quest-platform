begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);
set local role authenticated;
select set_config('test.quote',public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'TEST-CODE')::text,true);
select is(current_setting('test.quote')::jsonb->>'base_amount_minor','12345','цена берётся из серверного предложения');
select is(current_setting('test.quote')::jsonb->>'amount_minor','0','100 процентов без доплаты');
select is(current_setting('test.quote')::jsonb->>'requires_payment','false','платёж провайдеру не нужен');
select is(current_setting('test.quote')::jsonb->>'reserved','false','просмотр ещё не резервирует период');
select ok(not(current_setting('test.quote')::jsonb ? 'shop_id'),'служебный идентификатор магазина не раскрывается');
select is(public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'WRONG')->>'reason','invalid_code','ошибочный код не даёт скидку');
reset role;
select is((select count(*) from public.billing_discount_reservations where organization_id=current_setting('test.org')::uuid),0::bigint,'просмотр не расходует периоды');
select is((select count(*) from public.billing_sandbox_orders where organization_id=current_setting('test.org')::uuid),0::bigint,'просмотр не создаёт заказ');
select ok(not has_function_privilege('anon','public.preview_sandbox_discount_offer(uuid,uuid,text)','execute'),'анонимный вызов закрыт');
select * from finish();
rollback;
