begin;
select no_plan();
insert into auth.users(id,email) values(md5('timeline-buyer')::uuid,'timeline-buyer@example.test');
select set_config('request.jwt.claim.sub',md5('timeline-buyer')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
-- Отдельный синтетический тариф не зависит от пользовательских черновиков и версий.
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit)
values(md5('checkout-v1')::uuid,'checkout_test',1,'Synthetic 1',5,3),
(md5('checkout-v2')::uuid,'checkout_test',2,'Synthetic 2',6,3),
(md5('checkout-v3')::uuid,'checkout_test',3,'Synthetic 3',7,3);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('checkout-v1')::uuid,md5('checkout-v1')::uuid,'checkout_test',now()-interval '2 days'),
(md5('checkout-v3')::uuid,md5('checkout-v3')::uuid,'checkout_test',now()+interval '2 days');
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until)
select md5('checkout-offer-'||n)::uuid,current_setting('test.org')::uuid,md5('checkout-v'||n)::uuid,0,100*n,'123','https://stage.qvesta.ru',now(),now()+interval '1 day',now()+interval '1 hour'
from generate_series(1,3)n;
set local role authenticated;
select is(jsonb_array_length(public.list_sandbox_checkout_offers(current_setting('test.org')::uuid)),1,'только актуальное предложение: будущие и неопубликованные скрыты');
select throws_ok($t$select public.accept_sandbox_checkout_offer(current_setting('test.org')::uuid,md5('checkout-offer-3')::uuid,md5('future-command')::uuid)$t$,'22023','tariff version no longer current','будущую версию нельзя купить прямым RPC');
select set_config('test.order',public.accept_sandbox_checkout_offer(current_setting('test.org')::uuid,md5('checkout-offer-1')::uuid,md5('accepted-command')::uuid)::text,true);
reset role;
-- Новая версия уже вступила; принятый ранее заказ остаётся на v1.
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('checkout-v2')::uuid,md5('checkout-v2')::uuid,'checkout_test',now()-interval '1 day');
set local role authenticated;
select is(public.list_sandbox_checkout_offers(current_setting('test.org')::uuid)->0->>'plan_version_id',md5('checkout-v2')::uuid::text,'новые покупки видят v2');
select is(public.accept_sandbox_checkout_offer(current_setting('test.org')::uuid,md5('checkout-offer-1')::uuid,md5('accepted-command')::uuid)::text,current_setting('test.order'),'retry сохраняет принятый заказ v1');
select throws_ok($t$select public.accept_sandbox_checkout_offer(current_setting('test.org')::uuid,md5('checkout-offer-1')::uuid,md5('new-command')::uuid)$t$,'22023','tariff version no longer current','новая команда не покупает старую версию');
reset role;
select is((select plan_version_id from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),md5('checkout-v1')::uuid,'принятая версия не переписана');
select is((select amount_minor from public.billing_sandbox_orders where id=current_setting('test.order')::uuid),100::bigint,'принятая цена не переписана');
select ok((public.begin_sandbox_payment_send(current_setting('test.order')::uuid)->>'can_send')::boolean,'принятый заказ можно отправить после смены версии');
select throws_ok($t$select public.reserve_sandbox_payment_order(current_setting('test.org')::uuid,md5('direct-old')::uuid,0,md5('checkout-v1')::uuid,100,'123','https://stage.qvesta.ru',now(),now()+interval '1 day')$t$,'22023','tariff version no longer current','нижний серверный путь тоже проверяет актуальность');
select * from finish();
rollback;
