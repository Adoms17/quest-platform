begin;
select no_plan();
insert into auth.users(id,email) select md5('grace-quota-'||n)::uuid,'grace-quota-'||n||'@example.test' from generate_series(0,3)n;
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=md5('grace-quota-0')::uuid),true);
select set_config('request.jwt.claim.sub',md5('grace-quota-0')::uuid::text,true);
-- Синтетические исторические подтверждения для разных серверных границ.
create function pg_temp.period(ending timestamptz) returns void language plpgsql as $$begin
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
period_start=now()-interval '30 days',period_end=ending,active_quest_quota_enabled=true,team_member_quota_enabled=true where organization_id=current_setting('test.org')::uuid;
insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
select gen_random_uuid(),organization_id,jsonb_build_object('plan',plan_version_id,'start',period_start,'end',period_end),
'{}'::jsonb,jsonb_build_object('revision',revision) from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid;
end $$;
select pg_temp.period(now()-interval '1 day');
select is(public.get_organization_billing_overview(current_setting('test.org')::uuid)->>'status','grace','кабинет показывает grace');
select is(public.get_organization_billing_overview(current_setting('test.org')::uuid)->'effective_entitlements'->>'active_quests','5','лимиты сохранены');
select is((public.get_organization_billing_state(current_setting('test.org')::uuid)->>'grace_end')::timestamptz,now()+interval '4 days','граница от конца периода');
insert into public.quests(id,creator_id,organization_id,title,is_open) select md5('grace-q-'||n)::uuid,md5('grace-quota-0')::uuid,current_setting('test.org')::uuid,'Grace test',false from generate_series(1,6)n;
set local role authenticated;
select lives_ok($$update public.quests set is_open=true where id in (select md5('grace-q-'||n)::uuid from generate_series(1,5)n)$$,'в grace доступны 5 квестов');
select throws_ok($$update public.quests set is_open=true where id=md5('grace-q-6')::uuid$$,'P0001','active quest quota exceeded','grace не снимает квоту');
reset role;
select lives_ok($$insert into public.organization_memberships(organization_id,user_id) select current_setting('test.org')::uuid,md5('grace-quota-'||n)::uuid from generate_series(1,2)n$$,'команда до 3 с владельцем');
select throws_ok($$insert into public.organization_memberships(organization_id,user_id) values(current_setting('test.org')::uuid,md5('grace-quota-3')::uuid)$$,'P0001','team member quota exceeded','четвёртый сотрудник запрещён');
select public.record_organization_subscription_expiration(current_setting('test.org')::uuid,(select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid));
select is(public.get_organization_billing_state(current_setting('test.org')::uuid)->>'status','grace','scheduler не обрывает grace');
update public.quests set is_open=false where id=md5('grace-q-1')::uuid;
select lives_ok($$update public.quests set is_open=true where id=md5('grace-q-6')::uuid$$,'слот доступен после технического истечения');
select pg_temp.period(now()-interval '6 days');
select is(public.get_organization_billing_state(current_setting('test.org')::uuid)->>'status','expired','после grace истёк');
select is(public.get_organization_billing_state(current_setting('test.org')::uuid)->'effective_entitlements','null'::jsonb,'кабинет не обещает доступные лимиты');
select throws_ok($$update public.quests set is_open=true where id=md5('grace-q-1')::uuid$$,'P0001','quest quota unavailable','новое открытие после grace запрещено');
select lives_ok($$update public.quests set is_open=false where id=md5('grace-q-2')::uuid$$,'закрытие после grace разрешено');
select lives_ok($$update public.quests set title='Updated' where id=md5('grace-q-3')::uuid$$,'редактирование сохранено');
select lives_ok($$update public.quests set is_open=true where id=md5('grace-q-3')::uuid$$,'повтор открытого квеста сохранён');
update public.organization_memberships set status='suspended' where organization_id=current_setting('test.org')::uuid and user_id=md5('grace-quota-2')::uuid;
select throws_ok($$update public.organization_memberships set status='active' where organization_id=current_setting('test.org')::uuid and user_id=md5('grace-quota-2')::uuid$$,'P0001','team quota unavailable','восстановление после grace запрещено');
select lives_ok($$update public.organization_memberships set status='active' where organization_id=current_setting('test.org')::uuid and user_id=md5('grace-quota-1')::uuid$$,'повтор активного членства сохранён');
update public.organization_subscriptions set active_quest_quota_enabled=false,team_member_quota_enabled=false where organization_id=current_setting('test.org')::uuid;
select lives_ok($$update public.quests set is_open=true where id=md5('grace-q-1')::uuid$$,'opt-out сохраняется');
select lives_ok($$update public.organization_memberships set status='active' where organization_id=current_setting('test.org')::uuid and user_id=md5('grace-quota-2')::uuid$$,'opt-out команды сохраняется');
select * from finish();
rollback;
