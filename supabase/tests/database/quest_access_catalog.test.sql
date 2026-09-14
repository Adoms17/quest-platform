begin;

select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('1b000000-0000-4000-8000-000000000001', 'access-owner@example.test', '{"username":"Access owner"}'),
  ('1b000000-0000-4000-8000-000000000002', 'invited@example.test', '{"username":"Invited"}'),
  ('1b000000-0000-4000-8000-000000000003', 'outsider-access@example.test', '{"username":"Outsider"}');

insert into public.quests (id, creator_id, organization_id, title, is_public)
values (
  '2b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000001',
  (select id from public.organizations where personal_owner_id = '1b000000-0000-4000-8000-000000000001'),
  'Private access quest', false
);

insert into public.quest_access_credentials(quest_id,kind,email,token_hash,created_by,created_at,expires_at)
select '2b000000-0000-4000-8000-000000000001','invitation','person'||n||'@example.test',md5(n::text)||md5(n::text),'1b000000-0000-4000-8000-000000000001',now()-interval '2 days'-n*interval '1 minute',case when n=1 then now()-interval '1 day' else now()+interval '1 day' end from generate_series(1,40) n;
insert into public.participant_profiles(id,display_name,profile_kind,age_group,created_by_user_id)
select ('99000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Участник '||n,'dependent','child','1b000000-0000-4000-8000-000000000001' from generate_series(1,40) n;
insert into public.quest_access_grants(quest_id,user_id,participant_profile_id)
select '2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000001',id from public.participant_profiles where id::text like '99000000-%';
create function pg_temp.cat(k text default 'credentials',s text default '',c jsonb default null) returns jsonb language sql as $$select public.search_quest_access_catalog('2b000000-0000-4000-8000-000000000001',k,s,c)$$;
select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.cat()->'items'),25,'страница способов входа');
select is(jsonb_array_length(pg_temp.cat('credentials','',pg_temp.cat()->'next_cursor')->'items'),15,'продолжение способов входа');
select is(pg_temp.cat('credentials','person39')->'items'->0->>'email','person39@example.test','поиск дальней записи');
select is(pg_temp.cat()->'items'->0->>'display_status','expired','истечение вычислено сервером');
select ok(not (pg_temp.cat()->'items'->0 ? 'token_hash'),'нет хеша');
select ok(not (pg_temp.cat()->'items'->0 ? 'credential_token'),'нет секрета');
select is(jsonb_array_length(pg_temp.cat('grants')->'items'),25,'страница прав');
select is(jsonb_array_length(pg_temp.cat('grants','',pg_temp.cat('grants')->'next_cursor')->'items'),15,'продолжение прав');
select is(pg_temp.cat('grants','Участник 39')->'items'->0->>'participant_display_name','Участник 39','показан конкретный профиль вместо аккаунта взрослого');
select is(jsonb_array_length(pg_temp.cat('grants','access-owner@')->'items'),25,'поиск по аккаунту');
select throws_ok($$select pg_temp.cat('grants','',pg_temp.cat()->'next_cursor')$$,'22023','invalid invitation cursor','курсор связан с видом списка');
select throws_ok($$select pg_temp.cat('credentials','новый поиск',pg_temp.cat()->'next_cursor')$$,'22023','invalid invitation cursor','курсор связан с поиском');
select throws_ok($$select pg_temp.cat('other')$$,'22023','invalid access catalog','неизвестный каталог отклоняется');
select throws_ok($$select pg_temp.cat('credentials',repeat('x',201))$$,'22023','invalid invitation search','поиск ограничен');
reset role;
select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select pg_temp.cat()$$,'42501','quest access management denied','чужие способы входа закрыты');
select throws_ok($$select pg_temp.cat('grants')$$,'42501','quest access management denied','чужие права закрыты');
reset role;
select ok(not has_function_privilege('anon','public.search_quest_access_catalog(uuid,text,text,jsonb,integer)','execute'),'anon запрещён');
select * from finish();
rollback;
