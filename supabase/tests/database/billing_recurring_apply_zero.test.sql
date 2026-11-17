begin;
select no_plan();
-- Только синтетический серверный снимок уже оплаченного периода и подтверждённого согласия.
insert into auth.users(id,email) values(md5('recurring-order-owner')::uuid,'recurring-order-owner@example.test');
select set_config('request.jwt.claim.sub',md5('recurring-order-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select set_config('test.plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select set_config('test.ends',(now()+interval '3 seconds')::text,true);
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,gen_random_uuid(),0,current_setting('test.plan')::uuid,((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz);
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('recurring-source-offer')::uuid,current_setting('test.org')::uuid,current_setting('test.plan')::uuid,0,10000,'123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,now()-interval '1 day',1);
insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,state,offer_id)
values(md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),gen_random_uuid(),current_setting('test.plan')::uuid,0,5000,'RUB','123','https://stage.qvesta.ru',((current_setting('test.ends')::timestamptz at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',current_setting('test.ends')::timestamptz,'finished',md5('recurring-source-offer')::uuid);
insert into public.billing_recurring_consents(id,order_id,organization_id,actor_id,terms_version)
values(md5('recurring-source-consent')::uuid,md5('recurring-source-order')::uuid,current_setting('test.org')::uuid,auth.uid(),'sandbox-recurring-v2');
insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
values(md5('recurring-source-consent')::uuid,'synthetic-method',gen_random_uuid());
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('zero-code')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('zero-code','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote,state)
values(md5('zero-initial')::uuid,md5('zero-code')::uuid,current_setting('test.org')::uuid,'{}','{}','consumed');
select set_config('test.prepared',platform_private.prepare_recurring_order(md5('recurring-source-consent')::uuid,current_setting('test.ends')::timestamptz,1)->>'order_id',true);
select pg_sleep(3);
savepoint changed;
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select is(platform_private.apply_recurring_period(current_setting('test.prepared')::uuid)->>'state','cancelled','отмена подписки блокирует бесплатное продление');
rollback to changed;
select is(platform_private.apply_recurring_period(current_setting('test.prepared')::uuid)->>'state','applied','100% скидка выдаёт период');
select is((select count(*) from public.billing_recurring_attempts where order_id=current_setting('test.prepared')::uuid),0::bigint,'нулевая сумма не создаёт платёж');
select is((select state from public.billing_discount_reservations where order_id=current_setting('test.prepared')::uuid),'consumed','льготный период использован');
select is(platform_private.apply_recurring_period(current_setting('test.prepared')::uuid)->>'state','applied','повтор нулевого периода безопасен');
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),2::bigint,'одна выдача нулевого периода');
select * from finish();rollback;