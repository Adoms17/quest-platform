begin read only;
set local statement_timeout='20s';
set local search_path=pg_catalog;
select jsonb_build_object(
'extensions',(select jsonb_agg(to_jsonb(x) order by name,version) from (select v.name,v.version,v.installed,v.superuser,v.trusted,v.relocatable,v.schema,v.requires from pg_available_extension_versions v join pg_available_extensions e on e.name=v.name and e.default_version=v.version where v.name in ('pg_cron','pg_net','supabase_vault')) x),
'preload',current_setting('shared_preload_libraries'),
'cron_database',current_setting('cron.database_name',true),
'postgres_create_database_objects',has_database_privilege('postgres',current_database(),'CREATE'),
'event_triggers',(select jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'owner',pg_get_userbyid(e.evtowner),'function',e.evtfoid::regprocedure::text,'tags',e.evttags) order by e.evtname) from pg_event_trigger e)
) as inventory;
rollback;
