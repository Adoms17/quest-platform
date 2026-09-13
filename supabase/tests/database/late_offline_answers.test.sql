begin;
select plan(7);
insert into auth.users(id,email) values('af000000-0000-4000-8000-000000000001','offline-policy@example.test');
insert into public.quests(id,creator_id,title,is_public,time_limit_minutes,verification_options)
values('af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001','Strict',true,1,'["code"]'::jsonb);
select is((select allow_late_offline_answers from public.quests where id='af100000-0000-4000-8000-000000000001'),false,'late offline delivery disabled by default');
insert into public.tasks(id,quest_id,title,static_code,correct_answer) values
('af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','First','entry','yes'),
('af200000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000001','Second','entry','yes');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000001',true);
select set_config('app.policy_attempt',(select id::text from public.start_quest_attempt('af100000-0000-4000-8000-000000000001')),true);
update public.quest_attempts set started_at=now()-interval '2 minutes',deadline_at=now()-interval '1 minute' where id=current_setting('app.policy_attempt')::uuid;
set local role authenticated;
select is(public.submit_offline_task_event(current_setting('app.policy_attempt')::uuid,'af200000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000001','open',now()-interval '90 seconds','entry')->>'reason','time_limit_reached','strict policy rejects late delivery');
reset role;
update public.quests set allow_late_offline_answers=true where id='af100000-0000-4000-8000-000000000001';
select set_config('app.policy_attempt',(select id::text from public.start_quest_attempt('af100000-0000-4000-8000-000000000001')),true);
update public.quest_attempts set started_at=now()-interval '2 minutes',deadline_at=now()-interval '1 minute' where id=current_setting('app.policy_attempt')::uuid;
set local role authenticated;
select is(public.submit_offline_task_event(current_setting('app.policy_attempt')::uuid,'af200000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000002','open',now()-interval '90 seconds','entry')->>'accepted','true','opt-in accepts opening before answer');
select set_config('app.policy_receipt',public.submit_offline_task_event(current_setting('app.policy_attempt')::uuid,'af200000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000003','answer',now()-interval '85 seconds','yes')::text,true);
select is(current_setting('app.policy_receipt')::jsonb->>'completed','true','answer validated normally despite delivery after deadline');
select is(public.submit_offline_task_event(current_setting('app.policy_attempt')::uuid,'af200000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000003','answer',now()-interval '85 seconds','yes'),current_setting('app.policy_receipt')::jsonb,'offline replay idempotent');
select is(public.submit_task_event(current_setting('app.policy_attempt')::uuid,'af200000-0000-4000-8000-000000000002','af300000-0000-4000-8000-000000000004','open','entry')->>'reason','time_limit_reached','normal online delivery remains strict');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.submit_offline_task_event(current_setting('app.policy_attempt')::uuid,'af200000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000005','answer',now()-interval '90 seconds','yes')$$,'42501','quest attempt access denied','foreign attempt protected');
select * from finish();
rollback;
