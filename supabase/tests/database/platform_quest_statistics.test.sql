begin;
select no_plan();
insert into auth.users(id,email) values(md5('stats-owner')::uuid,'stats-owner@example.test'),(md5('stats-other')::uuid,'stats-other@example.test');
select set_config('request.jwt.claim.sub',md5('stats-owner')::uuid::text,true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
select set_config('test.other',(select id::text from public.organizations where personal_owner_id=md5('stats-other')::uuid),true);
insert into public.quests(id,organization_id,creator_id,title,is_open,is_public) values
 (md5('stats-q1')::uuid,current_setting('test.org')::uuid,auth.uid(),'Statistics fixture',true,true),
 (md5('stats-q2')::uuid,current_setting('test.other')::uuid,auth.uid(),'Statistics fixture 2',true,true);
insert into public.quest_attempts(id,quest_id,user_id,participant_profile_id,total_tasks,started_at,finished_at) values
 (md5('stats-a')::uuid,md5('stats-q1')::uuid,auth.uid(),auth.uid(),0,'2026-08-31 20:59Z','2026-09-01 21:00Z'),
 (md5('stats-b')::uuid,md5('stats-q1')::uuid,auth.uid(),auth.uid(),0,'2026-08-31 21:00Z','2026-09-01 20:59Z'),
 (md5('stats-c')::uuid,md5('stats-q1')::uuid,auth.uid(),auth.uid(),0,'2026-09-01 21:00Z','2026-09-02 21:00Z'),
 (md5('stats-d')::uuid,md5('stats-q2')::uuid,auth.uid(),auth.uid(),0,'2026-09-01 22:00Z','2026-09-02 21:00Z'),
 (md5('stats-e')::uuid,md5('stats-q2')::uuid,auth.uid(),md5('stats-other')::uuid,0,'2026-09-01 23:00Z',null);
update public.quests set verification_mode='hybrid' where id=md5('stats-q2')::uuid;
update public.quest_attempts set total_tasks=2,completed_tasks=1,failed_tasks=1 where id in (md5('stats-b')::uuid,md5('stats-d')::uuid);
set local role authenticated;
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',current_setting('test.org')::uuid)$t$,'42501','platform access denied','membership alone denied');
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind,organization_id) values(auth.uid(),'operations','organization',current_setting('test.org')::uuid);
set local role authenticated;
select set_config('test.report',public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',current_setting('test.org')::uuid)::text,true);
select is(current_setting('test.report')::jsonb->'summary','{"unique_participants":1,"started_attempts":2,"finished_attempts":1,"early_finished":1,"in_progress":0,"stalled":0,"started_quests":1,"active_organizations":1}'::jsonb,'cohort totals deduplicate starts and partition completion');
select is(current_setting('test.report')::jsonb->'items'->0->>'finished_attempts','1','Moscow lower bound; complete on start day');
select is(current_setting('test.report')::jsonb->'items'->1->>'early_finished','1','later completion attributed to start day');
select is(current_setting('test.report')::jsonb->>'timezone','Europe/Moscow','explicit timezone');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02')$t$,'42501','platform access denied','scoped operations cannot read platform');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',current_setting('test.other')::uuid)$t$,'42501','platform access denied','foreign organization denied');
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',current_setting('test.org')::uuid)$t$,'42501','platform access denied','MFA required');
reset role;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
update public.platform_access_assignments set revoked_at=now() where user_id=auth.uid();
set local role authenticated;
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',current_setting('test.org')::uuid)$t$,'42501','platform access denied','revoked scope denied');
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind,valid_from,expires_at) values(auth.uid(),'operations','platform',now()-interval '2 days',now()-interval '1 day');
set local role authenticated;
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02')$t$,'42501','platform access denied','expired platform assignment denied');
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
set local role authenticated;
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'summary','{"unique_participants":2,"started_attempts":4,"finished_attempts":2,"early_finished":1,"in_progress":1,"stalled":0,"started_quests":2,"active_organizations":2}'::jsonb,'platform distinct profiles quests organizations, not sum of organization totals');
select is(public.read_platform_quest_statistics('2026-09-03','2026-09-04')->'summary','{"unique_participants":0,"started_attempts":0,"finished_attempts":0,"early_finished":0,"in_progress":0,"stalled":0,"started_quests":0,"active_organizations":0}'::jsonb,'finishes outside their start period do not count');
-- Two finishes at midnight Sept 3: q1 and q2.
select is(jsonb_array_length(public.read_platform_quest_statistics('2026-10-01','2026-10-03')->'items'),3,'zero days present');
select is(public.read_platform_quest_statistics('2026-10-01','2026-10-03')->'summary'->>'started_attempts','0','empty total zero');
select is(public.read_platform_quest_statistics('2026-08-31','2026-09-07','week')->'items'->0->>'to','2026-09-06','week ends Sunday');
select is(public.read_platform_quest_statistics('2026-08-31','2026-09-07','week')->'items'->1->>'from','2026-09-07','next week starts Monday');
select is(public.read_platform_quest_statistics('2026-08-31','2026-09-02','month')->'items'->0->>'to','2026-08-31','calendar month boundary');
select is(public.read_platform_quest_statistics('2026-08-31','2026-09-02','month')->'items'->1->>'to','2026-09-02','partial final month clipped');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-02','2026-09-01')$t$,'22023','invalid statistics period','reversed period');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','year')$t$,'22023','invalid statistics period','invalid grain');
select throws_ok($t$select public.read_platform_quest_statistics('2024-01-01','2026-09-02')$t$,'22023','too many statistics intervals','bounded result size');
select throws_ok($t$select public.read_platform_quest_statistics('infinity','infinity')$t$,'22023','invalid statistics period','nonfinite dates denied');
select ok(not exists(select 1 from jsonb_object_keys(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'items'->0) k where k not in ('from','to','unique_participants','started_attempts','finished_attempts','started_quests','active_organizations','by_mode','in_progress','stalled','early_finished')),'aggregates only');
reset role;
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',null,array['online'])->'summary'->>'started_attempts','2','single mode filters total');
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',null,array['online','hybrid'])->'summary'->>'unique_participants','2','multi-mode total deduplicates profiles');
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',null,array['secure_online'])->'summary'->>'started_attempts','0','empty selected mode returns zero');
select is(jsonb_array_length(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'by_mode'),3,'all mode rows even empty');
select is((select x->>'unique_participants' from jsonb_array_elements(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'by_mode')x where x->>'mode'='hybrid'),'2','separate mode counts');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',null,array[]::text[])$t$,'22023','invalid statistics modes','empty selection rejected');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',null,array['unknown'])$t$,'22023','invalid statistics modes','unknown mode rejected');
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02','day',null,null)$t$,'22023','invalid statistics modes','null modes rejected');
update public.quest_attempt_activity set last_activity_at=statement_timestamp()-interval '24 hours',is_estimated=true where quest_attempt_id=md5('stats-e')::uuid;
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'summary'->>'stalled','1','24 hours or more is stalled');
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->>'activity_history_partial','true','legacy uncertainty visible');
update public.quest_attempt_activity set last_activity_at=statement_timestamp()-interval '23 hours 59 minutes' where quest_attempt_id=md5('stats-e')::uuid;
select is(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'summary'->>'in_progress','1','less than 24 hours is in progress');
select ok(not exists(select 1 from jsonb_array_elements(public.read_platform_quest_statistics('2026-09-01','2026-09-02')->'items')x where (x->>'started_attempts')::int<>(x->>'in_progress')::int+(x->>'stalled')::int+(x->>'early_finished')::int+(x->>'finished_attempts')::int),'statuses partition every start');
select is((select count(*) from public.platform_role_permissions where permission_key='organization.statistics.read' and role_key in ('sales','support','regional')),0::bigint,'other roles excluded');
select ok(exists(select 1 from public.platform_audit_events where actor_id=auth.uid() and action='organization.statistics.read' and organization_id is null),'global reads audited');
set local role anon;
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02')$t$,'42501',null,'anon denied');
reset role;
set local role service_role;
select throws_ok($t$select public.read_platform_quest_statistics('2026-09-01','2026-09-02')$t$,'42501',null,'service role denied');
reset role;
select * from finish();
rollback;
