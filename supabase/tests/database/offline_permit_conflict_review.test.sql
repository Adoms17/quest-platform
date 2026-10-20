begin;
select no_plan();
insert into auth.users(id,email) values(md5('conflict-owner')::uuid,'conflict-owner@example.test'),(md5('conflict-outsider')::uuid,'conflict-outsider@example.test');
update public.organization_subscriptions set status='free',plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1)
where organization_id=(select id from public.organizations where personal_owner_id=md5('conflict-owner')::uuid);
insert into public.quests(id,creator_id,organization_id,title,is_open,is_public)
select md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,id,'Conflict test',true,true
from public.organizations where personal_owner_id=md5('conflict-owner')::uuid;
select set_config('request.jwt.claim.sub',md5('conflict-owner')::uuid::text,true);
select set_config('test.permit',public.prepare_offline_start_permit(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,md5('conflict-command')::uuid)->>'id',true);
create function pg_temp.archive(local_id text default 'second', event_id text default 'conflict-event') returns jsonb language sql as $$
select public.preserve_conflicting_offline_events(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,local_id,
jsonb_build_array(jsonb_build_object('clientEventId',md5(event_id)::uuid,'eventType','finish')),current_setting('test.permit')::uuid)
$$;
set local role authenticated;
select throws_ok($$select pg_temp.archive()$$,'23514','offline permit conflict not established','нельзя архивировать неиспользованное разрешение');
select public.register_permitted_offline_attempt(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,'first',current_setting('test.permit')::uuid);
select throws_ok($$select pg_temp.archive('first')$$,'23514','offline permit conflict not established','действительное прохождение не архивируется');
select is(pg_temp.archive()->>'state','needs_review','второе прохождение сохраняется для проверки');
select is(pg_temp.archive(),pg_temp.archive(),'retry возвращает прежние receipts');
select throws_ok($$select public.register_permitted_offline_attempt(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,'second',current_setting('test.permit')::uuid)$$,'P0001','offline permit conflict requires review','после потерянного ответа регистрация возвращает архивный маршрут');
select throws_ok($$select pg_temp.archive('other')$$,'23505','offline review event conflict','событие не перепривязывается к другой истории');
select is(pg_temp.archive('second','conflict-event-2')->>'state','needs_review','следующая пачка архивируется');
select throws_ok($$select public.preserve_conflicting_offline_events(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,'second',
  jsonb_build_array(jsonb_build_object('clientEventId',md5('conflict-event')::uuid,'eventType','finish','submittedValue','changed')),current_setting('test.permit')::uuid)$$,
  '23505','offline review event conflict','изменённый payload не подменяет архив');
select throws_ok($$select public.preserve_conflicting_offline_events(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,'second','[]'::jsonb,current_setting('test.permit')::uuid)$$,
  '22023','invalid review batch','пустая пачка не подтверждается');
select throws_ok($$select public.preserve_conflicting_offline_events(md5('conflict-quest')::uuid,md5('conflict-owner')::uuid,'second',
  jsonb_build_array(jsonb_build_object('clientEventId',md5('conflict-new')::uuid,'eventType','finish')),md5('unknown-permit')::uuid)$$,
  '42501','offline permit scope mismatch','чужой или неизвестный permit не принимается');
select throws_ok($$select count(*) from public.offline_event_reviews$$,'42501',null,'прямое чтение архива закрыто');
reset role;
select is((select count(*) from public.quest_attempts where quest_id=md5('conflict-quest')::uuid),1::bigint,'первая попытка единственная');
select is((select count(*) from public.offline_attempt_registrations where quest_id=md5('conflict-quest')::uuid),1::bigint,'сопоставление не смешивается');
select is((select count(*) from public.offline_event_reviews where quest_id=md5('conflict-quest')::uuid and review_reason='permit_conflict' and state='needs_review'),2::bigint,'события сохранены отдельно');
select ok((select finished_at is null from public.quest_attempts where quest_id=md5('conflict-quest')::uuid),'архивный finish не завершает первую попытку');
select set_config('request.jwt.claim.sub',md5('conflict-outsider')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.archive()$$,'42501','quest access denied','чужой профиль защищён');
reset role;
select ok(not has_function_privilege('anon','public.preserve_conflicting_offline_events(uuid,uuid,text,jsonb,uuid)','execute'),'анонимный вызов закрыт');
select ok(not has_function_privilege('authenticated','public.register_permitted_offline_attempt_core(uuid,uuid,text,uuid)','execute'),'core остаётся закрытым');
select * from finish();
rollback;
