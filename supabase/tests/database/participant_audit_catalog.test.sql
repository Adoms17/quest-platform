begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('98000000-0000-4000-8000-000000000001','catalog-owner@example.test','{"username":"Owner"}'),
('98000000-0000-4000-8000-000000000002','catalog-other@example.test','{"username":"Other"}');
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id) values('98000000-0000-4000-8000-000000000021','Участник','dependent','child','98000000-0000-4000-8000-000000000001');
insert into public.participant_audit_events(participant_profile_id,actor_user_id,action,entity_type,created_at)
select '98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000001','invitation.created','invitation',now() from generate_series(1,40);
insert into public.participant_audit_events(participant_profile_id,actor_user_id,action,entity_type)
values('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000002','invitation.accepted','invitation');
create function pg_temp.inv(p_search text default '',p_after jsonb default null) returns jsonb language sql as $$select public.search_participant_audit('98000000-0000-4000-8000-000000000021',p_search,p_after)$$;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.inv()->'items'),25,'первая порция');
select is(pg_temp.inv()->>'has_more','true','есть продолжение');
select is(jsonb_array_length(pg_temp.inv('',pg_temp.inv()->'next_cursor')->'items'),16,'вторая порция');
select is(pg_temp.inv('',pg_temp.inv()->'next_cursor')->>'has_more','false','конец списка');
select is(jsonb_array_length(pg_temp.inv('OTHER')->'items'),1,'владелец ищет события другого автора');
select ok(not ((pg_temp.inv()->'items'->0) ? 'metadata'),'metadata не возвращается');
select is(jsonb_typeof(pg_temp.inv()->'items'->0->'id'),'string','bigint ID передаётся строкой без потери точности');
select throws_ok($$select pg_temp.inv('different',pg_temp.inv()->'next_cursor')$$,'22023','invalid invitation cursor','курсор привязан к поиску');
select is(jsonb_array_length(public.search_participant_audit('98000000-0000-4000-8000-000000000099')->'items'),0,'события другого профиля не смешиваются');
select throws_ok($$select public.search_participant_audit('98000000-0000-4000-8000-000000000099','',pg_temp.inv()->'next_cursor')$$,'42501','participant audit visibility changed','курсор без прежней области видимости отклонён');
reset role;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.inv()->'items'),1,'обычный автор видит только своё событие');
select is(jsonb_array_length(pg_temp.inv('Owner')->'items'),0,'поиск не раскрывает чужие события');
reset role;
select ok(not has_function_privilege('anon','public.search_participant_audit(uuid,text,jsonb,integer)','execute'),'anon запрещён');
select * from finish();
rollback;
