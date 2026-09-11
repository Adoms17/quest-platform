begin;

select plan(7);

select has_column(
  'public',
  'tasks',
  'show_location_on_map',
  'tasks can explicitly expose a participant map location'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('4e000000-0000-4000-8000-000000000001', 'map-owner@example.test', '{}'::jsonb),
  ('4e000000-0000-4000-8000-000000000002', 'map-player@example.test', '{}'::jsonb);

insert into public.quests (
  id, creator_id, organization_id, title, is_public, verification_options
)
select
  '5e000000-0000-4000-8000-000000000001',
  '4e000000-0000-4000-8000-000000000001',
  organization.id,
  'Participant map visibility',
  true,
  '["gps"]'::jsonb
from public.organizations organization
where organization.personal_owner_id = '4e000000-0000-4000-8000-000000000001';

insert into public.tasks (
  id, quest_id, title, order_index, gps_point, show_location_on_map
)
values
  (
    '6e000000-0000-4000-8000-000000000001',
    '5e000000-0000-4000-8000-000000000001',
    'Visible point',
    0,
    public.st_setsrid(public.st_makepoint(33.5, 44.6), 4326),
    true
  ),
  (
    '6e000000-0000-4000-8000-000000000002',
    '5e000000-0000-4000-8000-000000000001',
    'Hidden point',
    1,
    public.st_setsrid(public.st_makepoint(34.5, 45.6), 4326),
    false
  );

select set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (select location_latitude from public.get_participant_tasks(
    '5e000000-0000-4000-8000-000000000001'
  ) where id = '6e000000-0000-4000-8000-000000000001'),
  44.6::double precision,
  'direct participant package exposes an allowed latitude'
);

select is(
  (select location_longitude from public.get_participant_tasks(
    '5e000000-0000-4000-8000-000000000001'
  ) where id = '6e000000-0000-4000-8000-000000000001'),
  33.5::double precision,
  'direct participant package exposes an allowed longitude'
);

select is(
  (select location_latitude from public.get_participant_tasks(
    '5e000000-0000-4000-8000-000000000001'
  ) where id = '6e000000-0000-4000-8000-000000000002'),
  null::double precision,
  'direct participant package keeps a hidden latitude private'
);

select is(
  (select location_longitude from public.get_participant_tasks_for_profile(
    '5e000000-0000-4000-8000-000000000001',
    '4e000000-0000-4000-8000-000000000002'
  ) where id = '6e000000-0000-4000-8000-000000000001'),
  33.5::double precision,
  'profile package exposes an allowed longitude'
);

select is(
  (select location_latitude from public.get_participant_tasks_for_profile(
    '5e000000-0000-4000-8000-000000000001',
    '4e000000-0000-4000-8000-000000000002'
  ) where id = '6e000000-0000-4000-8000-000000000002'),
  null::double precision,
  'profile package keeps a hidden latitude private'
);

select is(
  (select requires_gps from public.get_participant_tasks(
    '5e000000-0000-4000-8000-000000000001'
  ) where id = '6e000000-0000-4000-8000-000000000002'),
  true,
  'GPS verification remains enabled when the map point is hidden'
);

select * from finish();
rollback;

