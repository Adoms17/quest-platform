begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('8f000000-0000-4000-8000-000000000001', 'redemption-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('8f000000-0000-4000-8000-000000000002', 'redemption-parent@example.test', '{"username":"Parent"}'::jsonb),
  ('8f000000-0000-4000-8000-000000000003', 'redemption-outsider@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.quests (id, creator_id, title, is_public)
values ('8f100000-0000-4000-8000-000000000001', '8f000000-0000-4000-8000-000000000001', 'Participant redemption', false);
insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('8f200000-0000-4000-8000-000000000001', 'Child', 'dependent', 'child', '8f000000-0000-4000-8000-000000000002');
insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values ('8f000000-0000-4000-8000-000000000002', '8f200000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub', '8f000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select set_config('app.test_profile_link_token', (
  select credential_token from public.create_quest_access_credential(
    '8f100000-0000-4000-8000-000000000001', 'link', null, 2
  )
), true);
select set_config('app.test_profile_code', (
  select credential_token from public.create_quest_access_credential(
    '8f100000-0000-4000-8000-000000000001', 'code', null, 2
  )
), true);

reset role;
select set_config('request.jwt.claim.sub', '8f000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  format($$select * from public.redeem_quest_access_credential_for_participant(%L, '8f200000-0000-4000-8000-000000000001')$$, current_setting('app.test_profile_link_token')),
  'adult can redeem a link for a supervised participant'
);
select is(
  (select participant_profile_id from public.quest_access_grants where quest_id = '8f100000-0000-4000-8000-000000000001' and status = 'active'),
  '8f200000-0000-4000-8000-000000000001'::uuid,
  'grant belongs to the selected participant profile'
);
reset role;
select is(
  (select event.participant_profile_id
   from public.organization_audit_events event
   join public.quest_access_grants access_grant on access_grant.id = event.entity_id
   where event.entity_type = 'quest_access_grant'
     and event.action = 'quest_access.credential_redeemed'
     and access_grant.quest_id = '8f100000-0000-4000-8000-000000000001'
   order by event.id desc
   limit 1),
  '8f200000-0000-4000-8000-000000000001'::uuid,
  'audit event records the participant separately from the actor'
);
set local role authenticated;
select ok(public.can_actor_access_quest('8f100000-0000-4000-8000-000000000001', '8f200000-0000-4000-8000-000000000001'), 'adult can open the quest as the selected participant');
select isnt(public.can_access_quest('8f100000-0000-4000-8000-000000000001'), true, 'adult self profile remains without access');
select lives_ok(
  format($$select * from public.redeem_quest_access_credential_for_participant(%L, '8f200000-0000-4000-8000-000000000001')$$, current_setting('app.test_profile_link_token')),
  'repeated redemption returns the existing participant grant'
);
select is(
  (select success from public.redeem_quest_access_code_for_participant(current_setting('app.test_profile_code'), '8f000000-0000-4000-8000-000000000002')),
  true,
  'adult can independently redeem a code for their self profile'
);

reset role;
select set_config('request.jwt.claim.sub', '8f000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  format($$select * from public.redeem_quest_access_credential_for_participant(%L, '8f200000-0000-4000-8000-000000000001')$$, current_setting('app.test_profile_link_token')),
  '42501', 'participant profile access denied',
  'outsider cannot redeem a link for another participant profile'
);
select throws_ok(
  format($$select * from public.redeem_quest_access_code_for_participant(%L, '8f200000-0000-4000-8000-000000000001')$$, current_setting('app.test_profile_code')),
  '42501', 'participant profile access denied',
  'outsider cannot redeem a code for another participant profile'
);

select * from finish();
rollback;
