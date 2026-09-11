begin;

select plan(4);

select has_column(
  'public',
  'quests',
  'task_navigation_mode',
  'quests expose a participant task navigation mode'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('1d000000-0000-4000-8000-000000000001', 'navigation-owner@example.test', '{}'::jsonb);

insert into public.quests (id, creator_id, title)
values (
  '2d000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000001',
  'Default sequential quest'
);

select is(
  (select task_navigation_mode from public.quests where id = '2d000000-0000-4000-8000-000000000001'),
  'sequential',
  'existing create flows default to sequential navigation'
);

update public.quests
set task_navigation_mode = 'free'
where id = '2d000000-0000-4000-8000-000000000001';

select is(
  (select task_navigation_mode from public.quests where id = '2d000000-0000-4000-8000-000000000001'),
  'free',
  'free navigation can be stored explicitly'
);

select throws_ok(
  $$update public.quests set task_navigation_mode = 'hidden' where id = '2d000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'unsupported navigation modes are rejected'
);

select * from finish();
rollback;
