begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data)
select md5('team-user-'||n)::uuid,'team'||n||'@example.test',jsonb_build_object('username','Сотрудник '||n) from generate_series(0,61)n;
select set_config('test.team_org',(select id::text from public.organizations where personal_owner_id=md5('team-user-0')::uuid),true);
insert into public.organization_memberships(id,organization_id,user_id,status,created_at)
select md5('team-member-'||n)::uuid,current_setting('test.team_org')::uuid,md5('team-user-'||n)::uuid,
case when n%2=0 then 'suspended' else 'active' end,'2026-09-01'::timestamptz from generate_series(1,60)n;
insert into public.membership_roles(membership_id,role_id)
select md5('team-member-'||n)::uuid,r.id from generate_series(1,60)n cross join public.roles r where r.key='host';
insert into public.organization_invitations(id,organization_id,email,token_hash,invited_by,created_at,expires_at)
select md5('team-invite-'||n)::uuid,current_setting('test.team_org')::uuid,'invite'||n||'@example.test',
md5('team-token-'||n)||md5('team-token-'||n),md5('team-user-0')::uuid,now()-interval '2 days',
case when n=61 then now()-interval '1 day' else now()+interval '1 day' end from generate_series(1,61)n;
insert into public.organization_invitation_roles(invitation_id,role_id)
select md5('team-invite-'||n)::uuid,r.id from generate_series(1,61)n cross join public.roles r where r.key='host';
create function pg_temp.team(k text default 'members',s text default '',st text default 'all',c jsonb default null,l integer default 25)
returns jsonb language sql as $$select public.search_organization_team_catalog(current_setting('test.team_org')::uuid,k,s,st,c,l)$$;
select set_config('request.jwt.claim.sub',md5('team-user-0')::uuid::text,true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.team()->'items'),25,'команда: порция 25');
select is(jsonb_array_length(pg_temp.team(l=>999)->'items'),50,'максимум 50');
select is(jsonb_array_length(pg_temp.team(l=>0)->'items'),1,'минимум 1');
select is(pg_temp.team(s=>'сОТРУДНИК 60')->'items'->0->>'username','Сотрудник 60','поиск имени вне первой страницы');
select is(pg_temp.team(s=>'team59@')->'items'->0->>'email','team59@example.test','поиск email');
select is(pg_temp.team(s=>'team59@')->'items'->0->'roles'->0->>'key','host','роли включены');
select is(jsonb_array_length(pg_temp.team(st=>'suspended',l=>50)->'items'),30,'точный статус членства');
select is(jsonb_array_length(pg_temp.team('invitations')->'items'),25,'приглашения: порция 25');
select is(pg_temp.team('invitations','invite61@')->'items'->0->>'display_status','expired','истечение вычисляется сервером');
select is(jsonb_array_length(pg_temp.team('invitations','invite61@','pending')->'items'),0,'просроченное pending не считается действующим');
select is(pg_temp.team('invitations','invite60@')->'items'->0->'roles'->0->>'key','host','роли приглашения включены');
select ok(not(pg_temp.team('invitations')->'items'->0 ?| array['token','token_hash','invited_by','accepted_by']),'нет секретов и лишних идентификаторов');
create temporary table traversed(kind text,id text,primary key(kind,id));
do $$declare k text; p jsonb; c jsonb; begin
 foreach k in array array['members','invitations'] loop
 c:=null;
 loop
  p:=pg_temp.team(k,c=>c);
  insert into traversed select k,x->>'id' from jsonb_array_elements(p->'items')x;
  exit when not(p->>'has_more')::boolean;
  c:=p->'next_cursor';
 end loop;
 end loop;
end$$;
select is((select count(*) from traversed where kind='members'),61::bigint,'вся команда без дублей и пропусков при одинаковых датах');
select is((select count(*) from traversed where kind='invitations'),61::bigint,'все приглашения без дублей и пропусков');
select throws_ok($$select pg_temp.team('invitations',c=>pg_temp.team()->'next_cursor')$$,'22023','invalid team cursor','курсор привязан к каталогу');
select throws_ok($$select pg_temp.team(s=>'другой',c=>pg_temp.team()->'next_cursor')$$,'22023','invalid team cursor','курсор привязан к поиску');
select throws_ok($$select pg_temp.team(st=>'active',c=>pg_temp.team()->'next_cursor')$$,'22023','invalid team cursor','курсор привязан к статусу');
select throws_ok($$select pg_temp.team(c=>jsonb_set(pg_temp.team()->'next_cursor','{actor_id}','"other"'))$$,'22023','invalid team cursor','курсор привязан к аккаунту');
select throws_ok($$select pg_temp.team(c=>jsonb_set(pg_temp.team()->'next_cursor','{organization_id}','"other"'))$$,'22023','invalid team cursor','курсор привязан к организации');
select throws_ok($$select pg_temp.team(st=>'pending')$$,'22023','invalid team filter','неподходящий статус отклонён');
select throws_ok($$select pg_temp.team(s=>repeat('x',201))$$,'22023','invalid team filter','длина поиска ограничена');
reset role;
select set_config('request.jwt.claim.sub',md5('team-user-61')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.team()$$,'42501','organization team catalog access denied','чужая команда закрыта');
select throws_ok($$select pg_temp.team('invitations')$$,'42501','organization team catalog access denied','чужие приглашения закрыты');
reset role;
-- Синтетическая роль проверяет независимость members.read и members.manage.
insert into public.roles(id,key,name,is_system) values(md5('team-reader')::uuid,'test_team_reader','Тест чтения команды',false);
insert into public.role_permissions(role_id,permission_id) select md5('team-reader')::uuid,id from public.permissions where key='members.read';
insert into public.membership_roles(membership_id,role_id) values(md5('team-member-1')::uuid,md5('team-reader')::uuid);
select set_config('request.jwt.claim.sub',md5('team-user-1')::uuid::text,true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.team()->'items'),25,'members.read достаточно для команды');
select throws_ok($$select pg_temp.team('invitations')$$,'42501','organization team catalog access denied','members.read не даёт приглашения');
reset role;
update public.organization_memberships set status='revoked' where id=md5('team-member-1')::uuid;
set local role authenticated;
select throws_ok($$select pg_temp.team()$$,'42501','organization team catalog access denied','отзыв членства закрывает чтение');
reset role;
select ok(not has_function_privilege('anon','public.search_organization_team_catalog(uuid,text,text,text,jsonb,integer)','execute'),'anon запрещён');
select * from finish();
rollback;
