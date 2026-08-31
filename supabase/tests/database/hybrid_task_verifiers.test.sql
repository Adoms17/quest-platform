begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('14000000-0000-4000-8000-000000000001', 'hybrid-creator@example.test', '{"username":"hybrid-creator"}'::jsonb),
  ('14000000-0000-4000-8000-000000000002', 'hybrid-player@example.test', '{"username":"hybrid-player"}'::jsonb);

insert into public.quests (
  id, creator_id, title, is_public, verification_options, verification_mode
)
values
  ('24000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'Hybrid quest', true, '["code"]'::jsonb, 'hybrid'),
  ('24000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000001', 'Secure quest', true, '["code"]'::jsonb, 'secure_online'),
  ('24000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000001', 'Online quest', true, '["code"]'::jsonb, 'online');

insert into public.tasks (
  id, quest_id, title, static_code, correct_answer,
  code_client_verifier, answer_client_verifier
)
select
  task_id,
  quest_id,
  'Verifier task',
  'CODE',
  'answer',
  '{"version":1,"kdf":"PBKDF2","hash":"SHA-256","iterations":600000,"normalization":"trim-lowercase-v1","purpose":"code","salt":"AAAAAAAAAAAAAAAAAAAAAA==","digest":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'::jsonb,
  '{"version":1,"kdf":"PBKDF2","hash":"SHA-256","iterations":600000,"normalization":"trim-lowercase-v1","purpose":"answer","salt":"AQEBAQEBAQEBAQEBAQEBAQ==","digest":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="}'::jsonb
from (values
  ('34000000-0000-4000-8000-000000000001'::uuid, '24000000-0000-4000-8000-000000000001'::uuid),
  ('34000000-0000-4000-8000-000000000002'::uuid, '24000000-0000-4000-8000-000000000002'::uuid),
  ('34000000-0000-4000-8000-000000000003'::uuid, '24000000-0000-4000-8000-000000000003'::uuid)
) as rows(task_id, quest_id);

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select ok(
  (select code_verifier is not null and answer_verifier is not null
   from public.get_participant_tasks('24000000-0000-4000-8000-000000000001')),
  'hybrid mode exposes preliminary verifiers'
);

select ok(
  (select code_verifier is null and answer_verifier is null
   from public.get_participant_tasks('24000000-0000-4000-8000-000000000002')),
  'secure_online mode exposes no client verifier'
);

select ok(
  (select code_verifier is null and answer_verifier is null
   from public.get_participant_tasks('24000000-0000-4000-8000-000000000003')),
  'online mode exposes no client verifier'
);

reset role;

select throws_ok(
  $$
    update public.tasks
    set code_client_verifier = jsonb_set(
      code_client_verifier, '{iterations}', '1'::jsonb
    )
    where id = '34000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'database rejects downgraded verifier iterations'
);

select throws_ok(
  $$
    update public.tasks
    set code_client_verifier = jsonb_set(
      code_client_verifier, '{purpose}', '"answer"'::jsonb
    )
    where id = '34000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'database rejects a verifier bound to the wrong purpose'
);

select * from finish();

rollback;
