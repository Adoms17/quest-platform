begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data)
select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'adult'||n||'@example.test',jsonb_build_object('username','Взрослый '||lpad(n::text,2,'0')) from generate_series(1,42)n;
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id)
values('97000000-0000-4000-8000-000000000099','Участник','dependent','child','97000000-0000-4000-8000-000000000041');
insert into public.participant_supervisions(participant_profile_id,supervisor_user_id)
select '97000000-0000-4000-8000-000000000099',('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,40)n;
create function pg_temp.catalog(p_search text default '',p_after jsonb default null) returns jsonb language sql as $$select public.search_participant_supervisors('97000000-0000-4000-8000-000000000099',p_search,p_after)$$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000041',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog()->'items'),25,'первая страница владельца');
select is(jsonb_array_length(pg_temp.catalog('',pg_temp.catalog()->'next_cursor')->'items'),15,'вторая страница');
select is(pg_temp.catalog('',pg_temp.catalog()->'next_cursor')->>'has_more','false','конец списка');
select is(jsonb_array_length(pg_temp.catalog('ADULT39')->'items'),1,'поиск email без регистра');
select is(jsonb_array_length(pg_temp.catalog('Взрослый 39')->'items'),1,'поиск имени');
select throws_ok($$select pg_temp.catalog('changed',pg_temp.catalog()->'next_cursor')$$,'22023','invalid supervisor cursor','курсор связан с поиском');
select ok(not ((pg_temp.catalog()->'items'->0) ? 'encrypted_password'),'лишние сведения аккаунта отсутствуют');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.catalog()->'items'),1,'контролирующий видит только себя');
select is(jsonb_array_length(pg_temp.catalog('adult39')->'items'),0,'поиск не раскрывает других взрослых');
reset role;
update public.participant_supervisions set status='revoked' where supervisor_user_id='97000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.catalog()->'items'->0->>'status','revoked','собственная отозванная связь остаётся видимой');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000042',true);
set local role authenticated;
select throws_ok($$select pg_temp.catalog()$$,'42501','participant supervision visibility denied','чужой аккаунт не получает связи');
reset role;
select ok(not has_function_privilege('anon','public.search_participant_supervisors(uuid,text,jsonb,integer)','execute'),'анонимный вызов запрещён');
select * from finish();
rollback;
