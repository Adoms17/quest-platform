begin;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('7f000000-0000-4000-8000-000000000001', 'profile-quest-owner@example.test', '{"username":"Quest owner"}'::jsonb),
  ('7f000000-0000-4000-8000-000000000002', 'profile-parent@example.test', '{"username":"Parent"}'::jsonb),
  ('7f000000-0000-4000-8000-000000000003', 'profile-outsider@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.quests (id, creator_id, title, is_public)
values ('7f100000-0000-4000-8000-000000000001', '7f000000-0000-4000-8000-000000000001', 'Profile scoped quest', false);

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('7f200000-0000-4000-8000-000000000001', 'Child', 'dependent', 'child', '7f000000-0000-4000-8000-000000000002');
insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values ('7f000000-0000-4000-8000-000000000002', '7f200000-0000-4000-8000-000000000001');

insert into public.quest_access_grants (quest_id, user_id, participant_profile_id)
values ('7f100000-0000-4000-8000-000000000001', '7f000000-0000-4000-8000-000000000002', '7f200000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub', '7f000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(public.current_self_participant_profile_id(), '7f000000-0000-4000-8000-000000000002'::uuid, 'account resolves its active self participant profile');
select ok(public.can_actor_access_quest('7f100000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000001'), 'supervisor can use a child participant grant');
select isnt(public.can_access_quest('7f100000-0000-4000-8000-000000000001'), true, 'child grant does not grant the adult self profile access');
select is((select count(*) from public.quest_access_grants), 1::bigint, 'supervisor can read the supervised participant grant');

reset role;
select set_config('request.jwt.claim.sub', '7f000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select isnt(public.can_actor_access_quest('7f100000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000001'), true, 'outsider cannot act as another participant');
select is((select count(*) from public.quest_access_grants), 0::bigint, 'outsider cannot read another participant grant');

reset role;
select ok(
  not exists(select 1 from public.quest_access_grants where participant_profile_id is null),
  'grant backfill leaves no participant profile gaps'
);
select ok(
  not exists(select 1 from public.quest_attempts where actor_user_id is null or participant_profile_id is null),
  'attempt backfill leaves no actor or participant gaps'
);

select * from finish();
rollback;
