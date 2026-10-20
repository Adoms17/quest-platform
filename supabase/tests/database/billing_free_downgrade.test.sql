begin;
select no_plan();
insert into auth.users(id,email) select md5('free-down-'||n)::uuid,'free-down-'||n||'@example.test' from generate_series(1,3)n;
create function pg_temp.org(n integer) returns uuid language sql as $$select id from public.organizations where personal_owner_id=md5('free-down-'||n)::uuid$$;
update public.organization_subscriptions set status='active',
 plan_version_id=(select id from public.billing_plan_versions where plan_key='business' and version=1),
 period_start=now()-interval '2 days',period_end=now()-interval '1 day'
 where organization_id in (pg_temp.org(1),pg_temp.org(2),pg_temp.org(3));
update public.organization_subscriptions set scheduled_plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1),scheduled_effective_at=period_end
 where organization_id in (pg_temp.org(1),pg_temp.org(3));
update public.organization_subscriptions set scheduled_plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),scheduled_effective_at=period_end where organization_id=pg_temp.org(2);
update public.organization_subscriptions set period_end=now()+interval '1 day' where organization_id=pg_temp.org(3);
insert into public.quests(creator_id,organization_id,title,is_open,is_public)
 select md5('free-down-1')::uuid,pg_temp.org(1),'Preserved '||n,true,true from generate_series(1,3)n;
select set_config('test.rev',(select revision::text from public.organization_subscriptions where organization_id=pg_temp.org(1)),true);
select is(public.apply_requested_free_downgrade(pg_temp.org(1),current_setting('test.rev')::bigint)->>'applied','true','явный Free исполнен');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(1)),'free','Free без платного подтверждения');
select is((select count(*) from public.quests where organization_id=pg_temp.org(1) and is_open),3::bigint,'сверхлимитные квесты не закрыты и не удалены');
select is(public.apply_requested_free_downgrade(pg_temp.org(1),current_setting('test.rev')::bigint)->>'applied','true','точный повтор безопасен');
select is((select count(*) from public.billing_free_downgrade_events where organization_id=pg_temp.org(1)),1::bigint,'один аудит');
select is(public.apply_requested_free_downgrade(pg_temp.org(2),(select revision from public.organization_subscriptions where organization_id=pg_temp.org(2)))->>'applied','false','платный downgrade ждёт подтверждения');
select is(public.apply_requested_free_downgrade(pg_temp.org(3),(select revision from public.organization_subscriptions where organization_id=pg_temp.org(3)))->>'applied','false','устаревший Free не применяется');
select lives_ok($$select public.run_billing_lifecycle(100)$$,'общий обработчик проходит после исполнения');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(2)),'expired','истечение не назначает неоплаченный Pro');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(3)),'active','новый период сохранён');
select ok(not has_function_privilege('authenticated','public.apply_requested_free_downgrade(uuid,bigint)','execute'),'клиент не исполняет смену');
select ok(not has_table_privilege('authenticated','public.billing_free_downgrade_events','select'),'аудит закрыт');
select * from finish();
rollback;
