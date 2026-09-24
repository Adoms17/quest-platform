-- Read-only inventory. No row contents, object paths, cron commands or secrets.
BEGIN READ ONLY;
SELECT json_build_object(
 'database_bytes', pg_database_size(current_database()),
 'user_tables', (SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%'),
 'public_tables_without_rls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
 'storage_objects', (SELECT count(*) FROM storage.objects),
 'storage_buckets', (SELECT count(*) FROM storage.buckets),
 'migrations', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'active_cron_jobs', (SELECT count(*) FROM cron.job WHERE active),
 'extensions', (SELECT json_agg(extname ORDER BY extname) FROM pg_extension)
) AS backup_inventory;
COMMIT;