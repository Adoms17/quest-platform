begin;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('9d000000-0000-4000-8000-000000000001', 'history-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('9d000000-0000-4000-8000-000000000002', 'history-parent@example.test', '{"username":"Parent"}'::jsonb),
  ('9d000000-0000-4000-8000-000000000003', 'history-outsider@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.quests (id, creator_id, title)
values ('9d100000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'History quest');

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('9d200000-0000-4000-8000-000000000001', 'History child', 'dependent', 'child', '9d000000-0000-4000-8000-000000000002');

insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values ('9d000000-0000-4000-8000-000000000002', '9d200000-0000-4000-8000-000000000001');

insert into public.quest_attempts (
  id, quest_id, user_id, actor_user_id, participant_profile_id,
  total_tasks, completed_tasks, failed_tasks, total_attempts, total_time,
  percent_success, finished_at
) values (
  '9d300000-0000-4000-8000-000000000001',
  '9d100000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000002',
  '9d000000-0000-4000-8000-000000000002',
  '9d200000-0000-4000-8000-000000000001',
  2, 1, 1, 2, 60, 50, now()
);


insert into public.quest_attempts(id,quest_id,user_id,actor_user_id,participant_profile_id,started_at,finished_at,total_tasks)
select ('9d300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '9d100000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000002',
 '9d000000-0000-4000-8000-000000000002','9d200000-0000-4000-8000-000000000001',
 case when n=2 then null else '2026-09-01'::timestamptz end,now(),1 from generate_series(2,61)n;
select set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000002',true);
set local role authenticated;
create temporary table history_pages as
select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001') payload;
select is(jsonb_array_length(payload->'items'),25,'Первая порция ограничена 25') from history_pages;
select is(payload->'items'->0->>'quest_attempt_id','9d300000-0000-4000-8000-000000000002','Сохранён порядок NULLS FIRST') from history_pages;
insert into history_pages select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001',payload->'next_cursor') from history_pages limit 1;
insert into history_pages select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001',payload->'next_cursor') from history_pages offset 1 limit 1;
select is((select count(distinct item->>'quest_attempt_id') from history_pages, jsonb_array_elements(payload->'items')item),61::bigint,'Все записи с одинаковым временем выданы без пропусков');
select is((select count(*) from history_pages, jsonb_array_elements(payload->'items')item),61::bigint,'Нет дублей между порциями');
select is((select payload->>'has_more' from history_pages offset 2 limit 1),'false','Последняя порция закрывает список');
select is(jsonb_array_length(public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001',null,999)->'items'),50,'Сервер ограничивает размер порции');
select throws_ok($$select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001','{}')$$,'22023','invalid history cursor','Чужой или неполный курсор отклонён');
select ok(not exists(select 1 from history_pages,jsonb_array_elements(payload->'items')item where item ?| array['user_id','actor_user_id','answers','code']),'Только безопасные поля истории');
select is(jsonb_array_length(public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001',
 public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001',null,1)->'next_cursor',50)->'items'),50,'Курсор после NULL-даты продолжает историю');
select throws_ok($$select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001',
 (select jsonb_set(payload->'next_cursor','{profile_id}','"9d200000-0000-4000-8000-000000000099"') from history_pages limit 1))$$,
 '22023','invalid history cursor','Курсор другого профиля отклонён');
reset role;
update public.participant_supervisions set status='suspended' where participant_profile_id='9d200000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001')$$,'42501','participant history access denied','Приостановленный контроль закрывает историю');
reset role;
select set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.search_participant_quest_history('9d200000-0000-4000-8000-000000000001')$$,'42501','participant history access denied','Чужая история закрыта');
select * from finish();
rollback;
