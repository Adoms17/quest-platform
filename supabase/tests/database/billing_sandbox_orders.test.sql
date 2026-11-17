begin;
select no_plan();
insert into auth.users(id,email) values(md5('sandbox-owner')::uuid,'sandbox-owner@example.test'),(md5('sandbox-other')::uuid,'sandbox-other@example.test');
create function pg_temp.org() returns uuid language sql as $$select id from public.organizations where personal_owner_id=md5('sandbox-owner')::uuid$$;
create function pg_temp.reserve(c integer default 1,a bigint default 100) returns jsonb language sql as $$select public.reserve_sandbox_payment_order(pg_temp.org(),md5('sandbox-'||c)::uuid,0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),a,'123456','https://stage.qvesta.ru/organization/billing',now(),now()+interval '1 month')$$;
select set_config('request.jwt.claim.sub',md5('sandbox-owner')::text,true);
select set_config('test.order',pg_temp.reserve()::text,true);
select is(pg_temp.reserve(),current_setting('test.order')::jsonb,'повтор возвращает исходный заказ');
select throws_ok($$select pg_temp.reserve(1,200)$$,'22023','sandbox command conflict','изменение суммы при retry запрещено');
select throws_ok($$select pg_temp.reserve(2)$$,'P0001','sandbox order already pending','другая команда не создаёт вторую оплату');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org()),'unconfigured','резервирование не активирует подписку');
select is((current_setting('test.order')::jsonb)->>'first_sent_at',null,'резервирование не начинает окно API');
select set_config('test.send',public.begin_sandbox_payment_send((current_setting('test.order')::jsonb->>'id')::uuid)::text,true);
select is(current_setting('test.send')::jsonb->>'can_send','true','первая отправка разрешена');
select is(public.begin_sandbox_payment_send((current_setting('test.order')::jsonb->>'id')::uuid),current_setting('test.send')::jsonb,'повтор сохраняет первое время и ключ');
select is(current_setting('test.send')::jsonb->'order'->>'environment','sandbox','контракт отделён от production');
select throws_ok($$update public.billing_sandbox_orders set amount_minor=200$$,'55000','sandbox order terms immutable','условия неизменяемы даже служебным обновлением');
select throws_ok($$update public.billing_sandbox_orders set first_sent_at=now()+interval '1 hour'$$,'55000','sandbox order terms immutable','окно нельзя продлить');
select set_config('request.jwt.claim.sub',md5('sandbox-other')::text,true);
select throws_ok($$select pg_temp.reserve()$$,'42501','billing management denied','чужая организация закрыта');
select throws_ok($$select public.begin_sandbox_payment_send((current_setting('test.order')::jsonb->>'id')::uuid)$$,'42501','billing management denied','чужая отправка закрыта');
select ok((select relrowsecurity from pg_class where oid='public.billing_sandbox_orders'::regclass),'RLS включена');
select ok(not has_function_privilege('authenticated','public.begin_sandbox_payment_send(uuid)','execute'),'клиент не вызывает отправку напрямую');
set local role authenticated;
select throws_ok($$select * from public.billing_sandbox_orders$$,'42501',null,'прямое чтение закрыто');
reset role;
-- Просроченный неопределённый запрос не получает новое окно или новый ключ.
insert into public.billing_sandbox_orders(organization_id,actor_id,command_id,expected_revision,plan_version_id,amount_minor,currency,shop_id,return_url,period_start,period_end,first_sent_at,state)
select id,md5('sandbox-other')::uuid,gen_random_uuid(),0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),100,'RUB','123456','https://stage.qvesta.ru',now(),now()+interval '1 month',now()-interval '24 hours','sending'
from public.organizations where personal_owner_id=md5('sandbox-other')::uuid;
select is((select public.begin_sandbox_payment_send(id)->>'can_send' from public.billing_sandbox_orders where actor_id=md5('sandbox-other')::uuid),'false','после окна отправка запрещена');
select is((select state from public.billing_sandbox_orders where actor_id=md5('sandbox-other')::uuid),'review','неопределённый заказ требует сверки');
select * from finish();
rollback;
