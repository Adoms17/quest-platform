begin;
select no_plan();
insert into auth.users(id,email) values
  (md5('billing-owner-a')::uuid,'billing-a@example.test'),
  (md5('billing-owner-b')::uuid,'billing-b@example.test');
select set_config('test.billing_org', (select id::text from public.organizations where personal_owner_id=md5('billing-owner-a')::uuid),true);
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid),'unconfigured','новая организация не получает переходные права');
select ok((select relrowsecurity from pg_class where oid='public.organization_subscriptions'::regclass),'RLS включён');
insert into public.organization_subscriptions(organization_id,status)
select id,'transition' from public.organizations on conflict (organization_id) do nothing;
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid),'unconfigured','повтор backfill не меняет новое состояние');
update public.organization_subscriptions set plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1)
where organization_id=current_setting('test.billing_org')::uuid;
select throws_ok($$update public.organization_subscriptions set status='transition' where organization_id=current_setting('test.billing_org')::uuid$$,'23514',null,'переходный режим не маскирует назначенный тариф');
select throws_ok($$update public.organization_subscriptions set status='paid' where organization_id=current_setting('test.billing_org')::uuid$$,'23514',null,'неподдерживаемый платёжный статус запрещён');
select set_config('request.jwt.claim.sub',md5('billing-owner-a')::uuid::text,true);
set local role authenticated;
select is((select count(*) from public.organization_subscriptions),1::bigint,'владелец видит только свою подписку');
select ok(public.has_organization_permission(current_setting('test.billing_org')::uuid,'billing.manage'),'исходные права владельца сохранены');
select throws_ok($$update public.organization_subscriptions set plan_version_id=null$$,'42501',null,'billing.manage не даёт прямую запись');
select throws_ok($$delete from public.organization_subscriptions$$,'42501',null,'клиент не удаляет подписку');
select throws_ok($$insert into public.organization_subscriptions(organization_id) values (gen_random_uuid())$$,'42501',null,'клиент не создаёт подписку');
reset role;
update public.organization_memberships set status='suspended' where user_id=md5('billing-owner-a')::uuid;
set local role authenticated;
select is((select count(*) from public.organization_subscriptions),0::bigint,'назначенная версия не заменяет активное членство');
reset role;
delete from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid;
select is((select count(*) from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid),0::bigint,'отсутствие строки не создаёт transition автоматически');
set local role anon;
select throws_ok($$select * from public.organization_subscriptions$$,'42501',null,'анонимный доступ закрыт');
reset role;
select * from finish();
rollback;
