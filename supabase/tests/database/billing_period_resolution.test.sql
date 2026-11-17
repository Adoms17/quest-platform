begin;
select no_plan();
insert into auth.users(id,email) values(md5('billing-period-owner')::uuid,'billing-period@example.test');
select set_config('test.billing_org',(select id::text from public.organizations where personal_owner_id=md5('billing-period-owner')::uuid),true);
select set_config('request.jwt.claim.sub',md5('billing-period-owner')::uuid::text,true);
create function pg_temp.billing() returns jsonb language sql as $$select public.get_organization_billing_state(current_setting('test.billing_org')::uuid)$$;
update public.organization_subscriptions set status='free',plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1) where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','free','Free без назначенного срока');
select is(pg_temp.billing()->'effective_entitlements'->>'active_quests','1','Free разрешается по версии');
update public.organization_subscriptions set plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1) where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','invalid','Pro нельзя выдать как Free');
select is(pg_temp.billing()->'effective_entitlements','null'::jsonb,'ошибочное состояние не выдаёт лимиты');
update public.organization_subscriptions set status='trial',period_start=now()-interval '1 day',period_end=now()+interval '1 day' where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','trial','явный действующий trial');
select is(pg_temp.billing()->'effective_entitlements'->>'team_members','3','trial использует выбранную версию');
update public.organization_subscriptions set status='active' where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','active','действующий серверный период');
update public.organization_subscriptions set period_end=now() where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','expired','конец периода исключён');
select is(pg_temp.billing()->'effective_entitlements','null'::jsonb,'истечение снимает эффективные лимиты');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid),'active','чтение не переписывает БД');
update public.organization_subscriptions set period_start=now()+interval '1 day',period_end=now()+interval '2 days' where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','not_started','будущий период не активен');
select throws_ok($$update public.organization_subscriptions set period_end=period_start where organization_id=current_setting('test.billing_org')::uuid$$,'23514',null,'пустой период запрещён');
select throws_ok($$update public.organization_subscriptions set period_end=null where organization_id=current_setting('test.billing_org')::uuid$$,'23514',null,'неявный бесконечный период запрещён');
select throws_ok($$update public.organization_subscriptions set period_end='infinity' where organization_id=current_setting('test.billing_org')::uuid$$,'23514',null,'бесконечный конец периода запрещён');
select throws_ok($$update public.organization_subscriptions set period_start='-infinity' where organization_id=current_setting('test.billing_org')::uuid$$,'23514',null,'бесконечное начало периода запрещено');
create function pg_temp.at_start() returns text language plpgsql as $$ begin
  update public.organization_subscriptions set status='active',period_start=statement_timestamp(),period_end=statement_timestamp()+interval '1 day'
  where organization_id=current_setting('test.billing_org')::uuid;
  return pg_temp.billing()->>'status';
end $$;
select is(pg_temp.at_start(),'active','начало периода включено');
-- Один SQL statement гарантирует точную границу серверных часов для resolver.
create function pg_temp.at_end() returns text language plpgsql as $$ begin
  update public.organization_subscriptions set period_start=statement_timestamp()-interval '1 day',period_end=statement_timestamp()
  where organization_id=current_setting('test.billing_org')::uuid;
  return pg_temp.billing()->>'status';
end $$;
select is(pg_temp.at_end(),'expired','точная граница конца исключена');
update public.organization_subscriptions set status='expired',period_start=now(),period_end=now()+interval '1 day' where organization_id=current_setting('test.billing_org')::uuid;
select is(pg_temp.billing()->>'status','expired','явно истёкшая подписка не возобновляется по датам');
select is(pg_temp.billing()->'effective_entitlements','null'::jsonb,'явное истечение не выдаёт права');
set local role authenticated;
select throws_ok($$update public.organization_subscriptions set status='active'$$,'42501',null,'клиент не подтверждает оплату');
select is(pg_temp.billing()->>'enforcement_enabled','false','enforcement пока выключен');
reset role;
select * from finish();
rollback;
