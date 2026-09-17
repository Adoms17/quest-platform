begin;
select no_plan();
insert into auth.users(id,email) values(md5('start-policy-owner')::uuid,'start-policy@example.test');
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=md5('start-policy-owner')::uuid),true);
select set_config('request.jwt.claim.sub',md5('start-policy-owner')::uuid::text,true);
select is((select quest_start_enforcement_enabled from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),false,'ограничения не включаются автоматически');
create function pg_temp.period(ending timestamptz) returns void language plpgsql as $$begin
 update public.organization_subscriptions set status='active',quest_start_enforcement_enabled=true,
 plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),period_start=now()-interval '30 days',period_end=ending
 where organization_id=current_setting('test.org')::uuid;
 insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
 select gen_random_uuid(),organization_id,jsonb_build_object('plan',plan_version_id,'start',period_start,'end',period_end),'{}'::jsonb,jsonb_build_object('revision',revision)
 from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid;
end $$;
insert into public.quests(id,creator_id,organization_id,title,is_open,is_public)
 select md5('start-policy-q-'||n)::uuid,md5('start-policy-owner')::uuid,current_setting('test.org')::uuid,'Start policy',true,true from generate_series(1,4)n;
select pg_temp.period(now()-interval '1 day');
set local role authenticated;
select set_config('test.permit',public.prepare_offline_start_permit(md5('start-policy-q-1')::uuid,md5('start-policy-owner')::uuid,md5('start-policy-command')::uuid)->>'id',true);
select lives_ok($$select public.start_quest_attempt(md5('start-policy-q-2')::uuid)$$,'online-старт разрешён в grace');
reset role;
select pg_temp.period(now()-interval '6 days');
set local role authenticated;
select throws_ok($$select public.start_quest_attempt(md5('start-policy-q-3')::uuid)$$,'P0001','quest start billing unavailable','старый online RPC защищён после grace');
select throws_ok($$select public.start_quest_attempt_for_participant(md5('start-policy-q-3')::uuid,md5('start-policy-owner')::uuid)$$,'P0001','quest start billing unavailable','профильный online RPC защищён');
select throws_ok($$select public.register_offline_quest_attempt(md5('start-policy-q-3')::uuid,md5('start-policy-owner')::uuid,'old-offline')$$,'P0001','quest start billing unavailable','старый пакет не обходит проверку');
select lives_ok($$select public.start_quest_attempt(md5('start-policy-q-2')::uuid)$$,'уже начатое прохождение продолжается');
select lives_ok($$select public.register_permitted_offline_attempt(md5('start-policy-q-1')::uuid,md5('start-policy-owner')::uuid,'prepared-local',current_setting('test.permit')::uuid)$$,'выданное право погашается после grace');
select throws_ok($$update public.organization_subscriptions set quest_start_enforcement_enabled=false where organization_id=current_setting('test.org')::uuid$$,'42501',null,'клиент не отключает флаг');
reset role;
insert into public.tasks(id,quest_id,title,static_code,correct_answer) values(md5('start-review-task')::uuid,md5('start-policy-q-3')::uuid,'Late legacy','CODE','ANSWER');
set local role authenticated;
select is(public.preserve_closed_offline_events(md5('start-policy-q-3')::uuid,md5('start-policy-owner')::uuid,'old-offline',jsonb_build_array(jsonb_build_object('clientEventId',md5('start-review-event')::uuid,'taskId',md5('start-review-task')::uuid,'eventType','answer','submittedValue','input')))->>'state','needs_review','старый пакет после grace сохранён без начисления');
reset role;
select is((select count(*) from public.quest_attempts where quest_id=md5('start-policy-q-3')::uuid),0::bigint,'нет частично созданной запрещённой попытки');
update public.organization_subscriptions set quest_start_enforcement_enabled=false where organization_id=current_setting('test.org')::uuid;
select lives_ok($$select public.start_quest_attempt(md5('start-policy-q-3')::uuid)$$,'opt-out сохраняет прежнее поведение');
-- Online-погашение общего резерва не ломает последующую доставку этой же online-попытки.
select pg_temp.period(now()+interval '1 day');
select public.prepare_offline_start_permit(md5('start-policy-q-4')::uuid,md5('start-policy-owner')::uuid,md5('start-policy-command-4')::uuid);
select set_config('test.online',(select id::text from public.start_quest_attempt(md5('start-policy-q-4')::uuid)),true);
set local role authenticated;
select is(public.register_offline_quest_attempt(md5('start-policy-q-4')::uuid,md5('start-policy-owner')::uuid,current_setting('test.online'),current_setting('test.online')::uuid)->>'id',current_setting('test.online'),'канонический online ID синхронизируется после погашения права');
select throws_ok($$select public.register_offline_quest_attempt(md5('start-policy-q-4')::uuid,md5('start-policy-owner')::uuid,'different-local',current_setting('test.online')::uuid)$$,'23505','offline permit registration required','независимая история не присоединяется');
reset role;
select * from finish();
rollback;
