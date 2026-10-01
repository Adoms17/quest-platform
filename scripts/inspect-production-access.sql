begin read only;
set local statement_timeout='20s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
with selected_roles as (select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role','authenticator','postgres'))
select jsonb_build_object(
'schemas',(select coalesce(jsonb_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]') from pg_namespace where nspname in ('public','platform_private')),
'column_acl',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'acl',a.attacl::text) order by n.nspname,c.relname,a.attname),'[]') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','platform_private') and a.attnum>0 and not a.attisdropped and a.attacl is not null),
'roles',(select jsonb_agg(to_jsonb(r)-'oid' order by rolname) from selected_roles r),
'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member)),'[]') from pg_auth_members where member in (select oid from selected_roles) or roleid in (select oid from selected_roles)),
'effective_schema',(select jsonb_agg(jsonb_build_object('role',r.rolname,'schema',n.nspname,'usage',has_schema_privilege(r.oid,n.oid,'USAGE'),'create',has_schema_privilege(r.oid,n.oid,'CREATE')) order by r.rolname,n.nspname) from selected_roles r cross join pg_namespace n where n.nspname in ('public','platform_private')),
'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace)
) as inventory;
rollback;
