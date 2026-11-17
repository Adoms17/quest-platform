begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.billing_plan_versions'::regclass), 'каталог защищён RLS');
select is((select count(*) from public.billing_plan_versions), 3::bigint, 'три согласованных уровня');
select results_eq(
  $$select plan_key, active_quests_limit, team_members_limit from public.billing_plan_versions order by plan_key$$,
  $$values ('business'::text,20,10),('free',1,1),('pro',5,3)$$,
  'точные согласованные entitlements');
select throws_ok($$update public.billing_plan_versions set active_quests_limit=99 where plan_key='free'$$,
  '55000','billing plan versions are immutable','сервер не меняет выданную версию');
select throws_ok($$delete from public.billing_plan_versions where plan_key='free'$$,
  '55000','billing plan versions are immutable','сохранена история версий');
select throws_ok($$truncate public.billing_plan_versions cascade$$,
  '55000','billing plan versions are immutable','truncate не обходит защиту');
select lives_ok($$insert into public.billing_plan_versions(plan_key,version,display_name,active_quests_limit,team_members_limit)
  values ('free',2,'Free',2,1)$$,'сервер может добавить новую версию');
select is((select active_quests_limit from public.billing_plan_versions where plan_key='free' and version=1),1,'старая версия сохранена');
select throws_ok($$insert into public.billing_plan_versions(plan_key,version,display_name,active_quests_limit,team_members_limit)
  values ('free',1,'Free',2,1)$$,'23505',null,'повтор версии запрещён');
set local role authenticated;
select is((select count(*) from public.billing_plan_versions),4::bigint,'аутентифицированный клиент читает общий каталог');
select throws_ok($$insert into public.billing_plan_versions(plan_key,version,display_name,active_quests_limit,team_members_limit)
  values ('fake',1,'Fake',999,999)$$,'42501',null,'клиент не создаёт тариф');
select throws_ok($$update public.billing_plan_versions set active_quests_limit=999$$,'42501',null,'клиент не меняет квоты');
select throws_ok($$delete from public.billing_plan_versions$$,'42501',null,'клиент не удаляет каталог');
reset role;
set local role anon;
select throws_ok($$select * from public.billing_plan_versions$$,'42501',null,'анонимный доступ закрыт');
reset role;
select * from finish();
rollback;
