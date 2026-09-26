-- Репетиция приёмки A/B. Только синтетические данные, вся транзакция откатывается.
-- Не вызывает Edge/провайдера и не создаёт постоянные stage-аккаунты.
begin;
select no_plan();
insert into auth.users(id,email)
select md5('stage-matrix-'||n)::uuid,'stage-matrix-'||n||'@example.test'
from generate_series(0,3)n;
select set_config('test.org_a',(select id::text from public.organizations where personal_owner_id=md5('stage-matrix-0')::uuid),true);
select set_config('test.org_b',(select id::text from public.organizations where personal_owner_id=md5('stage-matrix-1')::uuid),true);
insert into public.organization_memberships(id,organization_id,user_id,status)
values(md5('stage-matrix-reader')::uuid,current_setting('test.org_a')::uuid,md5('stage-matrix-2')::uuid,'active');
insert into public.membership_roles(membership_id,role_id)
select md5('stage-matrix-reader')::uuid,id from public.roles where key='sales_manager';
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until)
select md5('stage-matrix-offer-'||n)::uuid,
current_setting(case n when 0 then 'test.org_a' else 'test.org_b' end)::uuid,
(select id from public.billing_plan_versions where plan_key='pro' and version=1),
0,100,'123','https://stage.qvesta.ru/organization/billing',now(),now()+interval '1 day',now()+interval '1 hour'
from generate_series(0,1)n;
select set_config('request.jwt.claim.sub',md5('stage-matrix-0')::uuid::text,true);
set local role authenticated;
select ok(public.has_organization_permission(current_setting('test.org_a')::uuid,'billing.manage'),'владелец A имеет billing.manage');
select is(jsonb_array_length(public.list_sandbox_checkout_offers(current_setting('test.org_a')::uuid)),1,'владелец A видит одно своё предложение');
select throws_ok($$select public.list_sandbox_checkout_offers(current_setting('test.org_b')::uuid)$$,'42501','billing management denied','владелец A не видит каталог B');
select throws_ok($$select public.accept_sandbox_checkout_offer(current_setting('test.org_a')::uuid,md5('stage-matrix-offer-1')::uuid,gen_random_uuid())$$,'42501','sandbox offer unavailable','подстановка предложения B в организацию A запрещена');
select set_config('test.order_a',public.accept_sandbox_checkout_offer(current_setting('test.org_a')::uuid,md5('stage-matrix-offer-0')::uuid,md5('stage-matrix-command-a')::uuid)::text,true);
select is(public.accept_sandbox_checkout_offer(current_setting('test.org_a')::uuid,md5('stage-matrix-offer-0')::uuid,md5('stage-matrix-command-a')::uuid)::text,current_setting('test.order_a'),'retry возвращает заказ A');
select set_config('request.jwt.claim.sub',md5('stage-matrix-1')::uuid::text,true);
select is(jsonb_array_length(public.list_sandbox_checkout_offers(current_setting('test.org_b')::uuid)),1,'владелец B видит своё предложение');
select set_config('test.order_b',public.accept_sandbox_checkout_offer(current_setting('test.org_b')::uuid,md5('stage-matrix-offer-1')::uuid,md5('stage-matrix-command-b')::uuid)::text,true);
select throws_ok($$select public.get_sandbox_order_offer(current_setting('test.org_a')::uuid,current_setting('test.order_a')::uuid)$$,'42501',null,'владелец B не читает заказ A');
select throws_ok($$select public.get_sandbox_order_offer(current_setting('test.org_b')::uuid,current_setting('test.order_a')::uuid)$$,'42501',null,'подстановка заказа A в организацию B запрещена');
select set_config('request.jwt.claim.sub',md5('stage-matrix-2')::uuid::text,true);
select ok(public.has_organization_permission(current_setting('test.org_a')::uuid,'billing.read'),'сотрудник имеет billing.read');
select ok(not public.has_organization_permission(current_setting('test.org_a')::uuid,'billing.manage'),'сотрудник не имеет billing.manage');
select is(public.get_organization_billing_overview(current_setting('test.org_a')::uuid)->>'can_manage','false','сотруднику доступна сводка без управления');
select throws_ok($$select public.list_sandbox_checkout_offers(current_setting('test.org_a')::uuid)$$,'42501','billing management denied','сотруднику закрыт checkout-каталог');
select throws_ok($$select public.accept_sandbox_checkout_offer(current_setting('test.org_a')::uuid,md5('stage-matrix-offer-0')::uuid,gen_random_uuid())$$,'42501','billing management denied','сотрудник не создаёт заказ');
select set_config('request.jwt.claim.sub',md5('stage-matrix-3')::uuid::text,true);
select throws_ok($$select public.get_organization_billing_overview(current_setting('test.org_a')::uuid)$$,'42501','billing access denied','аккаунт без billing-прав не читает сводку');
select throws_ok($$select public.list_sandbox_checkout_offers(current_setting('test.org_a')::uuid)$$,'42501','billing management denied','аккаунт без billing-прав не видит предложения');
reset role;
select is((select count(*) from public.billing_sandbox_orders where organization_id in(current_setting('test.org_a')::uuid,current_setting('test.org_b')::uuid)),2::bigint,'ровно два заказа, по одному на организацию');
select ok((select bool_and(first_sent_at is null) from public.billing_sandbox_orders where organization_id in(current_setting('test.org_a')::uuid,current_setting('test.org_b')::uuid)),'платежи не отправлялись');
select is((select count(*) from public.billing_sandbox_application_scope where organization_id in(current_setting('test.org_a')::uuid,current_setting('test.org_b')::uuid)),0::bigint,'допуск выдачи подписки не включён автоматически');
select * from finish();
rollback;
