-- Read-only metadata inventory. Never selects customer rows, secrets or cron commands.
begin read only;
set local statement_timeout='20s';
set local lock_timeout='2s';
select version from supabase_migrations.schema_migrations order by version;
select n.nspname as schema_name,c.relname as relation_name,c.relkind,
 c.relrowsecurity as rls,c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'billing_%'
order by c.relname;
select n.nspname as schema_name,p.proname as function_name,
 pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef as security_definer,
 md5(p.prosrc) as body_fingerprint,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','platform_private')
and p.proname ~ '(billing|sandbox|subscription|receipt|fiscal|prepayment|purchase_document|checkout_document)'
order by n.nspname,p.proname,p.oid;
select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault') order by extname;
rollback;
