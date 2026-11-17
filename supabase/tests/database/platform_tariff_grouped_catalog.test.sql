begin;
select no_plan();
insert into auth.users(id,email) values(md5('group-reader')::uuid,'group-reader@example.test');
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(md5('group-reader')::uuid,'owner','platform');
select set_config('request.jwt.claim.sub',md5('group-reader')::uuid::text,true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit)
select md5('group-version-'||n)::uuid,'zz_group',n,'Group',1,1 from generate_series(1,30) n;
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
select id,id,plan_key,'2099-01-01'::timestamptz+make_interval(days=>version) from public.billing_plan_versions where plan_key='zz_group';
set local role authenticated;
select set_config('test.page',public.read_platform_tariff_catalog_chronological(jsonb_build_object('plan_key','zz_group','effective_at','2099-01-01','id',md5('cursor')::uuid))::text,true);
select is(jsonb_array_length(current_setting('test.page')::jsonb->'items'),25,'страница ограничена 25 версиями');
select is(current_setting('test.page')::jsonb#>>'{items,0,version}','1','первой идёт самая ранняя версия');
select is(current_setting('test.page')::jsonb#>>'{items,24,version}','25','сортировка хронологическая, не по UUID');
select set_config('test.next',public.read_platform_tariff_catalog_chronological(current_setting('test.page')::jsonb->'next_cursor')::text,true);
select is(jsonb_array_length(current_setting('test.next')::jsonb->'items'),5,'оставшиеся версии на следующей странице');
select is(current_setting('test.next')::jsonb#>>'{items,0,version}','26','граница без дубликатов');
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($t$select public.read_platform_tariff_catalog_chronological()$t$,'42501','platform access denied','MFA обязательна');
reset role;
select * from finish();rollback;
