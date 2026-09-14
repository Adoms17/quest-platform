begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 (md5('audit-owner')::uuid,'audit-owner@example.test','{"username":"Автор"}'),
 (md5('audit-reader')::uuid,'audit-reader@example.test','{"username":"Читатель"}');
select set_config('test.audit_org',(select id::text from public.organizations where personal_owner_id=md5('audit-owner')::uuid),true);
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id)
values(md5('audit-child')::uuid,'Участник','dependent','child',md5('audit-owner')::uuid);
insert into public.organization_audit_events(id,organization_id,actor_user_id,participant_profile_id,action,entity_type,entity_id,created_at,metadata)
overriding system value
select 9007199254741000+n,current_setting('test.audit_org')::uuid,md5('audit-owner')::uuid,md5('audit-child')::uuid,
case when n%2=0 then 'membership.roles_changed' else 'quest_access.grant_revoked' end,
case when n%2=0 then 'membership' else 'quest_access_grant' end,md5('audit-target')::uuid,'2026-09-01'::timestamptz,'{"role_keys":["host"]}'::jsonb
from generate_series(1,61)n;
create function pg_temp.audit(k text default 'all',c jsonb default null,l integer default 25)
returns jsonb language sql as $$select public.search_organization_audit(current_setting('test.audit_org')::uuid,k,c,l)$$;
select set_config('request.jwt.claim.sub',md5('audit-owner')::uuid::text,true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.audit()->'items'),25,'порция 25');
select is(jsonb_array_length(pg_temp.audit(l=>999)->'items'),50,'максимум 50');
select is(pg_temp.audit()->'items'->0->>'id','9007199254741061','bigint возвращается без потери точности');
select is(jsonb_typeof(pg_temp.audit()->'items'->0->'id'),'string','идентификатор строковый');
select is(pg_temp.audit()->'items'->0->>'participant_display_name','Участник','разрешённое имя участника');
select ok(not(pg_temp.audit()->'items'->0 ?| array['metadata','actor_user_id','participant_profile_id','entity_id','email','token']),'нет metadata и лишних идентификаторов');
select is(jsonb_array_length(pg_temp.audit('team',l=>50)->'items'),30,'фильтр команды');
select is(jsonb_array_length(pg_temp.audit('quest_access',l=>50)->'items'),31,'фильтр доступа к квестам');
create temporary table audit_ids(id text primary key);
do $$declare p jsonb; c jsonb:=null; begin loop
 p:=pg_temp.audit(c=>c); insert into audit_ids select x->>'id' from jsonb_array_elements(p->'items')x;
 exit when not(p->>'has_more')::boolean; c:=p->'next_cursor';
end loop; end$$;
select is((select count(*) from audit_ids),61::bigint,'все события при одинаковой дате без дублей и пропусков');
select throws_ok($$select pg_temp.audit('team',pg_temp.audit()->'next_cursor')$$,'22023','invalid audit cursor','курсор связан с категорией');
select throws_ok($$select pg_temp.audit(c=>jsonb_set(pg_temp.audit()->'next_cursor','{actor_id}','"other"'))$$,'22023','invalid audit cursor','курсор связан с аккаунтом');
select throws_ok($$select pg_temp.audit(c=>jsonb_set(pg_temp.audit()->'next_cursor','{organization_id}','"other"'))$$,'22023','invalid audit cursor','курсор связан с организацией');
select throws_ok($$select pg_temp.audit('unknown')$$,'22023','invalid audit category','неизвестная категория отклонена');
reset role;
select set_config('request.jwt.claim.sub',md5('audit-reader')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.audit()$$,'42501','organization audit access denied','чужой журнал закрыт');
reset role;
insert into public.roles(id,key,name,is_system) values(md5('audit-role')::uuid,'test_audit_manager','Тест журнала',false);
insert into public.role_permissions(role_id,permission_id) select md5('audit-role')::uuid,id from public.permissions where key='members.manage';
insert into public.organization_memberships(id,organization_id,user_id) values(md5('audit-member')::uuid,current_setting('test.audit_org')::uuid,md5('audit-reader')::uuid);
insert into public.membership_roles(membership_id,role_id) values(md5('audit-member')::uuid,md5('audit-role')::uuid);
set local role authenticated;
select is(jsonb_array_length(pg_temp.audit()->'items'),25,'members.manage разрешает журнал');
select ok((pg_temp.audit()->'items'->0->>'participant_display_name') is null,'без participants.read имя скрыто');
reset role;
update public.organization_memberships set status='revoked' where id=md5('audit-member')::uuid;
set local role authenticated;
select throws_ok($$select pg_temp.audit()$$,'42501','organization audit access denied','отзыв членства закрывает журнал');
reset role;
select ok(not has_function_privilege('anon','public.search_organization_audit(uuid,text,jsonb,integer)','execute'),'anon запрещён');
select * from finish();
rollback;
