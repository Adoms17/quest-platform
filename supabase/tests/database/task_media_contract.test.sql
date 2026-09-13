begin;

select plan(5);

select hasnt_column(
  'public',
  'tasks',
  'media_url',
  'tasks no longer exposes the obsolete scalar media URL'
);

select has_column(
  'public',
  'tasks',
  'media',
  'tasks retains the structured media collection'
);

select has_function(
  'public',
  'get_participant_tasks',
  array['uuid'],
  'participant task RPC remains available'
);

select has_function(
  'public',
  'get_participant_tasks_for_profile',
  array['uuid', 'uuid'],
  'profile-scoped participant task RPC remains available'
);

select ok(
  position('media jsonb' in pg_get_function_result('public.get_participant_tasks(uuid)'::regprocedure)) > 0
    and position('media_url' in pg_get_function_result('public.get_participant_tasks(uuid)'::regprocedure)) = 0
    and position('media jsonb' in pg_get_function_result('public.get_participant_tasks_for_profile(uuid, uuid)'::regprocedure)) > 0
    and position('media_url' in pg_get_function_result('public.get_participant_tasks_for_profile(uuid, uuid)'::regprocedure)) = 0,
  'participant RPC contracts expose structured media without media_url'
);

select * from finish();
rollback;
