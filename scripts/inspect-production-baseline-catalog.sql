-- Metadata only. No application rows, auth users, secrets or cron command text.
-- Extension-owned objects are excluded; compare them by extension version separately.
begin read only;
set local statement_timeout='20s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
with relations as (
 select c.*,n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','platform_private') and c.relkind in ('r','p','v','m','S','f')
 and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
), functions as (
 select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','platform_private') and p.prokind in ('f','p')
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
), entries as (
 select 'relations' as category,nspname||'.'||relname as key,
 jsonb_build_object('kind',relkind,'rls',relrowsecurity,'forceRls',relforcerowsecurity,
 'owner',pg_get_userbyid(relowner),'options',reloptions,
 'view',case when relkind in ('v','m') then pg_get_viewdef(oid,false) end) as value from relations
 union all
 select 'columns',r.nspname||'.'||r.relname||'.'||a.attname,
 jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
 'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(ad.adbin,ad.adrelid))
 from relations r join pg_attribute a on a.attrelid=r.oid left join pg_attrdef ad on ad.adrelid=r.oid and ad.adnum=a.attnum
 where a.attnum>0 and not a.attisdropped
 union all
 select 'policies',r.nspname||'.'||r.relname||'.'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
 'roles',(select jsonb_agg(case when role_oid=0 then 'PUBLIC' else pg_get_userbyid(role_oid) end order by (case when role_oid=0 then 'PUBLIC' else pg_get_userbyid(role_oid) end) collate "C") from unnest(p.polroles) role_oid),
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 from relations r join pg_policy p on p.polrelid=r.oid
 union all
 select 'functions',nspname||'.'||proname||'('||pg_get_function_identity_arguments(oid)||')',
 jsonb_build_object('definition',replace(pg_get_functiondef(oid),E'\r\n',E'\n'),'owner',pg_get_userbyid(proowner)) from functions
 union all
 select 'constraints',r.nspname||'.'||r.relname||'.'||c.conname,
 jsonb_build_object('definition',pg_get_constraintdef(c.oid,false),'validated',c.convalidated)
 from relations r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indexes',r.nspname||'.'||r.relname||'.'||ci.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready)
 from relations r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'triggers',r.nspname||'.'||r.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)
 from relations r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'relation_acl',r.nspname||'.'||r.relname||':'||coalesce(grantee.rolname,'PUBLIC')||':'||a.privilege_type||':'||grantor.rolname,
 jsonb_build_object('grantable',a.is_grantable)
 from relations r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 left join pg_roles grantee on grantee.oid=a.grantee join pg_roles grantor on grantor.oid=a.grantor
 union all
 select 'function_acl',f.nspname||'.'||f.proname||'('||pg_get_function_identity_arguments(f.oid)||'):'||coalesce(grantee.rolname,'PUBLIC')||':'||a.privilege_type||':'||grantor.rolname,
 jsonb_build_object('grantable',a.is_grantable)
 from functions f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 left join pg_roles grantee on grantee.oid=a.grantee join pg_roles grantor on grantor.oid=a.grantor
), grouped as (
 select category,count(*) as count,md5(string_agg(key||':'||value::text,E'\n' order by key collate "C",value::text collate "C")) as fingerprint
 from entries group by category
)
select jsonb_object_agg(category,jsonb_build_object('count',count,'md5',fingerprint) order by category) || jsonb_build_object('acl_summary',(select jsonb_agg(to_jsonb(a) order by category,role,privilege,grantor) from (
 select category,split_part(key,':',2) as role,split_part(key,':',3) as privilege,split_part(key,':',4) as grantor,count(*) as count
 from entries where category in ('relation_acl','function_acl') group by 1,2,3,4
) a)) as inventory from grouped;
rollback;
