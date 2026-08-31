begin;

select plan(3);

select has_column(
  'public',
  'task_attempts',
  'client_event_id',
  'task_attempts exposes a client event id'
);

select col_type_is(
  'public',
  'task_attempts',
  'client_event_id',
  'uuid',
  'client event id is a uuid'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as table_record
      on table_record.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'task_attempts'
      and constraint_record.conname = 'task_attempts_client_event_id_key'
      and constraint_record.contype = 'u'
  ),
  'client event ids are unique on the server'
);

select * from finish();

rollback;
