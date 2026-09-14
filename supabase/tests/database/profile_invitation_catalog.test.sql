begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('98000000-0000-4000-8000-000000000001','catalog-owner@example.test','{"username":"Owner"}'),
('98000000-0000-4000-8000-000000000002','catalog-other@example.test','{"username":"Other"}');
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id) values('98000000-0000-4000-8000-000000000021','Участник','dependent','child','98000000-0000-4000-8000-000000000001');
insert into public.participant_profile_invitations(participant_profile_id,invitation_kind,email,token_hash,created_by_user_id,created_at,expires_at)
select '98000000-0000-4000-8000-000000000021','supervisor','person'||n||'@example.test',repeat(md5(n::text),2),'98000000-0000-4000-8000-000000000001',now()-interval '2 days'-n*interval '1 minute',now()-interval '1 day' from generate_series(1,40) n;
insert into public.participant_profile_invitations(participant_profile_id,invitation_kind,email,token_hash,created_by_user_id,expires_at) values('98000000-0000-4000-8000-000000000021','claim','hidden@example.test',repeat('a',64),'98000000-0000-4000-8000-000000000002',now()+interval '7 days');
create function pg_temp.inv(p_search text default '',p_after jsonb default null) returns jsonb language sql as $$select public.search_my_profile_invitations('98000000-0000-4000-8000-000000000021',p_search,p_after)$$;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.inv()->'items'),25,'первая порция');
select is(pg_temp.inv()->>'has_more','true','есть продолжение');
select is(jsonb_array_length(pg_temp.inv('',pg_temp.inv()->'next_cursor')->'items'),15,'вторая порция');
select is(pg_temp.inv('',pg_temp.inv()->'next_cursor')->>'has_more','false','конец списка');
select is(jsonb_array_length(pg_temp.inv('hidden')->'items'),0,'чужие приглашения не раскрываются другому автору');
select is(jsonb_array_length(pg_temp.inv('PERSON39')->'items'),1,'поиск без учёта регистра');
select is(pg_temp.inv()->'items'->0->>'display_status','expired','срок вычисляется сервером');
select ok(not ((pg_temp.inv()->'items'->0) ? 'token_hash'),'hash не возвращается');
select ok(not ((pg_temp.inv()->'items'->0) ? 'invitation_token'),'секрет не возвращается');
select throws_ok($$select pg_temp.inv('different',pg_temp.inv()->'next_cursor')$$,'22023','invalid invitation cursor','курсор привязан к поиску');
select is(jsonb_array_length(public.search_my_profile_invitations('98000000-0000-4000-8000-000000000099')->'items'),0,'приглашения другого профиля не смешиваются');
select throws_ok($$select public.search_my_profile_invitations('98000000-0000-4000-8000-000000000099','',pg_temp.inv()->'next_cursor')$$,'22023','invalid invitation cursor','курсор другого профиля отклонён');
reset role;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.inv()->'items'),1,'другой автор видит только своё приглашение');
reset role;
select ok(not has_function_privilege('anon','public.search_my_profile_invitations(uuid,text,jsonb,integer)','execute'),'anon запрещён');
select * from finish();
rollback;
