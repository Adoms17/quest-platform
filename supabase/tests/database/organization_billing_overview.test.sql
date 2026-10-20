begin;
select no_plan();
insert into auth.users(id,email) select md5('overview-'||n)::uuid,'overview-'||n||'@example.test' from generate_series(0,3)n;
select set_config('test.overview_org',(select id::text from public.organizations where personal_owner_id=md5('overview-0')::uuid),true);
insert into public.organization_memberships(id,organization_id,user_id,status)
select md5('overview-member-'||n)::uuid,current_setting('test.overview_org')::uuid,md5('overview-'||n)::uuid,
case n when 1 then 'active' else 'suspended' end from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
select md5('overview-member-1')::uuid,id from public.roles where key in ('sales_manager','host');
insert into public.quests(creator_id,organization_id,title,is_open,is_public,start_at,end_at)
select md5('overview-0')::uuid,current_setting('test.overview_org')::uuid,'Overview fixture',n<4,n=1,
case when n=2 then now()+interval '1 day' end,case when n=3 then now()-interval '1 day' end from generate_series(1,4)n;
create function pg_temp.overview() returns jsonb language sql as $$select public.get_organization_billing_overview(current_setting('test.overview_org')::uuid)$$;
select set_config('request.jwt.claim.sub',md5('overview-0')::uuid::text,true);
set local role authenticated;
select is(pg_temp.overview()->'usage'->>'active_quests','3','открытые считаются независимо от расписания/публичности');
select is(pg_temp.overview()->'usage'->>'team_members','2','владелец и активный аккаунт; несколько ролей не удваивают расход');
select is(pg_temp.overview()->'enforcement'->>'team_members','false','квота команды пока выключена');
select is(pg_temp.overview()->>'status','unconfigured','использование доступно до подключения тарифа');
select ok(not(pg_temp.overview()->'usage' ? 'participants'),'не выдаём неизвестный расход участников за ноль');
select ok(pg_temp.overview()->>'measured_at' is not null,'есть серверное время снимка');
reset role;
select set_config('request.jwt.claim.sub',md5('overview-1')::uuid::text,true);
set local role authenticated;
select is(pg_temp.overview()->>'can_manage','false','продажи читают без управления тарифом');
select is(pg_temp.overview()->'usage'->>'active_quests','3','billing.read разрешает агрегаты');
reset role;
select set_config('request.jwt.claim.sub',md5('overview-3')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.overview()$$,'42501','billing access denied','чужие счётчики не раскрываются');
select throws_ok($$select public.get_organization_billing_overview(null)$$,'42501','billing access denied','null не раскрывает счётчики');
reset role;
set local role anon;
select throws_ok($$select pg_temp.overview()$$,'42501',null,'anon закрыт');
reset role;
select * from finish();
rollback;
