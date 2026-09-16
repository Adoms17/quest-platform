begin;
select no_plan();
insert into auth.users(id,email)
select md5('billing-rpc-'||n)::uuid,'billing-rpc-'||n||'@example.test' from generate_series(0,3)n;
select set_config('test.billing_org',(select id::text from public.organizations where personal_owner_id=md5('billing-rpc-0')::uuid),true);
insert into public.organization_memberships(id,organization_id,user_id,status)
select md5('billing-role-'||n)::uuid,current_setting('test.billing_org')::uuid,md5('billing-rpc-'||n)::uuid,'active' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
select md5('billing-role-'||n)::uuid,r.id from generate_series(1,2)n join public.roles r on r.key=case n when 1 then 'sales_manager' else 'admin' end;
create function pg_temp.billing() returns jsonb language sql as $$
  select public.get_organization_billing_state(current_setting('test.billing_org')::uuid)
$$;
select set_config('request.jwt.claim.sub',md5('billing-rpc-0')::uuid::text,true);
set local role authenticated;
select is(pg_temp.billing()->>'status','unconfigured','новая организация явно не подключена');
select is(pg_temp.billing()->'configured_plan','null'::jsonb,'не назначаем Free автоматически');
select is(pg_temp.billing()->>'can_manage','true','владелец управляет billing');
select is(pg_temp.billing()->>'enforcement_enabled','false','enforcement выключен');
select is(pg_temp.billing()->'effective_entitlements','null'::jsonb,'не выдаём эффективных entitlements');
reset role;
update public.organization_subscriptions set status='transition' where organization_id=current_setting('test.billing_org')::uuid;
set local role authenticated;
select is(pg_temp.billing()->>'status','transition','переходный режим читается явно');
reset role;
update public.organization_subscriptions set status='unconfigured',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1) where organization_id=current_setting('test.billing_org')::uuid;
set local role authenticated;
select is(pg_temp.billing()->'configured_plan'->'limits'->>'active_quests','5','условия выбранной версии');
select is(pg_temp.billing()->'effective_entitlements','null'::jsonb,'ссылка на Pro не активирует права');
reset role;
select set_config('request.jwt.claim.sub',md5('billing-rpc-1')::uuid::text,true);
set local role authenticated;
select is(pg_temp.billing()->>'can_manage','false','продажи читают, но не управляют');
select is((select count(*) from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid),1::bigint,'RLS разрешает billing.read');
reset role;
select set_config('request.jwt.claim.sub',md5('billing-rpc-2')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.billing()$$,'42501','billing access denied','администратор без billing.read не читает RPC');
select is((select count(*) from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid),0::bigint,'RLS скрывает от администратора');
reset role;
select set_config('request.jwt.claim.sub',md5('billing-rpc-3')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.billing()$$,'42501','billing access denied','чужая организация закрыта');
select throws_ok($$select public.get_organization_billing_state(null)$$,'42501','billing access denied','null не раскрывает информацию');
reset role;
select set_config('request.jwt.claim.sub',md5('billing-rpc-0')::uuid::text,true);
delete from public.organization_subscriptions where organization_id=current_setting('test.billing_org')::uuid;
set local role authenticated;
select is(pg_temp.billing()->>'status','missing','отсутствие строки не является transition');
reset role;
set local role anon;
select throws_ok($$select pg_temp.billing()$$,'42501',null,'anon не вызывает RPC');
reset role;
select * from finish();
rollback;
