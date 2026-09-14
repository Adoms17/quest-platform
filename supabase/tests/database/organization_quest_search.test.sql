-- Синтетические данные полностью откатываются; реальные организации не меняются.
begin;
select no_plan();
insert into auth.users (id, email, raw_user_meta_data) values
 ('91000000-0000-4000-8000-000000000001', 'ux03-owner@example.test', '{"username":"UX03 Owner"}'),
 ('91000000-0000-4000-8000-000000000002', 'ux03-other@example.test', '{"username":"UX03 Other"}'),
 ('91000000-0000-4000-8000-000000000003', 'ux03-reader@example.test', '{"username":"UX03 Reader"}');
do $$begin
 perform set_config('test.ux03_org', (select id::text from public.organizations where personal_owner_id = '91000000-0000-4000-8000-000000000001'), true);
 perform set_config('test.ux03_other', (select id::text from public.organizations where personal_owner_id = '91000000-0000-4000-8000-000000000002'), true);
end$$;
insert into public.quests (id, organization_id, creator_id, title, description, created_at, is_open, is_public)
select md5('ux03-' || n)::uuid, current_setting('test.ux03_org')::uuid,
 '91000000-0000-4000-8000-000000000001',
 case n when 10000 then 'Дальний маяк' when 9 then 'Скидка 100%_тест\путь' else 'Маршрут ' || lpad(n::text, 5, '0') end,
 repeat('Описание ', 30),
 case when n = 3 then null else '2026-09-01T10:00:00Z'::timestamptz end,
 case when n = 3 then null else n % 2 = 0 end, false
from generate_series(1,10000) n;
insert into public.quests (creator_id, organization_id, title, is_public)
values ('91000000-0000-4000-8000-000000000002', current_setting('test.ux03_other')::uuid, 'Чужой открытый квест', true);

create function pg_temp.quest_page(s text default '', st text default 'all', c jsonb default null, l integer default 25)
returns jsonb language sql security invoker as $$
 select public.search_organization_quests(current_setting('test.ux03_org')::uuid, s, st, c, l);
$$;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.quest_page()->'items'), 25, 'порция по умолчанию 25 при 10000 квестах');
select is((pg_temp.quest_page()->>'has_more')::boolean, true, 'сервер сообщает продолжение');
select is(jsonb_array_length(pg_temp.quest_page(l=>999)->'items'), 50, 'сервер ограничивает размер порции до 50');
select is(jsonb_array_length(pg_temp.quest_page(l=>0)->'items'), 1, 'нулевой размер нормализован до 1');
select is(jsonb_array_length(pg_temp.quest_page('дАЛЬНий')->'items'), 1, 'поиск без учёта регистра по всему набору');
select is(pg_temp.quest_page('Дальний')->'items'->0->>'title', 'Дальний маяк', 'найдено название за пределами исходной страницы');
select is(jsonb_array_length(pg_temp.quest_page('%_')->'items'), 1, 'символы LIKE ищутся буквально');
select is(jsonb_array_length(pg_temp.quest_page(E'\\путь')->'items'), 1, 'обратная косая черта ищется буквально');
select is(jsonb_array_length(pg_temp.quest_page('несуществующее')->'items'), 0, 'пустой ответ');
select is(pg_temp.quest_page('несуществующее')->'next_cursor', 'null'::jsonb, 'у пустого ответа нет курсора');
select is(pg_temp.quest_page('Дальний')->'next_cursor', 'null'::jsonb, 'у единственного результата нет продолжения');
select ok(not (pg_temp.quest_page()->'items'->0 ?| array['correct_answer','static_code','creator_id','verification_options']), 'в выдаче только поля списка');
select is(length(pg_temp.quest_page()->'items'->0->>'description'), 180, 'описание ограничено сервером');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.quest_page(st=>'open')->'items') x where not (x->>'is_open')::boolean), 'открытый фильтр');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.quest_page(st=>'closed')->'items') x where (x->>'is_open')::boolean), 'закрытый фильтр');
select is(jsonb_array_length(pg_temp.quest_page('Дальний', 'closed')->'items'), 0, 'поиск и статус применяются совместно');
select throws_ok($$select pg_temp.quest_page(st=>'invalid')$$, '22023', 'invalid quest search', 'неизвестный статус отклонён');
select throws_ok($$select pg_temp.quest_page(repeat('a',201))$$, '22023', 'invalid quest search', 'слишком длинный поиск отклонён');
select throws_ok($$select pg_temp.quest_page(c=>'{}')$$, '22023', 'invalid quest cursor', 'пустой курсор отклонён');
select throws_ok($$select pg_temp.quest_page('другой', c=>pg_temp.quest_page()->'next_cursor')$$, '22023', 'invalid quest cursor', 'курсор чужого поиска отклонён');
select throws_ok($$select pg_temp.quest_page(st=>'closed', c=>pg_temp.quest_page()->'next_cursor')$$, '22023', 'invalid quest cursor', 'курсор чужого статуса отклонён');
select is((select count(distinct x->>'id') from jsonb_array_elements((pg_temp.quest_page()->'items') || (pg_temp.quest_page(c=>pg_temp.quest_page()->'next_cursor')->'items')) x), 50::bigint, 'две страницы с одинаковой датой не дублируются');

-- Полный обход проверяет границу open/closed, одинаковые даты и NULL в конце.
create temporary table traversal (id uuid primary key, ordinal bigint generated always as identity, is_open boolean, created_at timestamptz);
do $$declare p jsonb; cursor jsonb := null; begin
 loop
  p := pg_temp.quest_page(c=>cursor, l=>50);
  insert into traversal(id, is_open, created_at)
    select (x->>'id')::uuid, (x->>'is_open')::boolean, (x->>'created_at')::timestamptz from jsonb_array_elements(p->'items') x;
  exit when not (p->>'has_more')::boolean;
  cursor := p->'next_cursor';
 end loop;
end$$;
select is((select count(*) from traversal),10000::bigint,'10000 записей получены без пропусков и повторов');
select is((select count(*) from traversal where is_open),5000::bigint,'все открытые квесты включены');
select is((select created_at from traversal order by ordinal desc limit 1), '-infinity'::timestamptz, 'NULL-дата имеет устойчивое положение');
select ok(not exists(select 1 from (select is_open, lag(is_open) over(order by ordinal) previous from traversal) s where not previous and is_open), 'закрытая группа не перемешана с открытой');

-- Курсор — значения, а не ссылка на существующую строку: удаление строки курсора безопасно.
do $$begin perform set_config('test.ux03_cursor', (pg_temp.quest_page()->'next_cursor')::text, true); end$$;
delete from public.quests where id = (current_setting('test.ux03_cursor')::jsonb->>'id')::uuid;
select is(jsonb_array_length(pg_temp.quest_page(c=>current_setting('test.ux03_cursor')::jsonb)->'items'),25,'удаление строки курсора не ломает следующую порцию');
select throws_ok($$select public.search_organization_quests(current_setting('test.ux03_other')::uuid)$$, '42501', 'organization quest access denied', 'чужая организация недоступна даже при публичном квесте');

reset role;
select ok((select prosecdef from pg_proc where oid='public.search_organization_quests(uuid,text,text,jsonb,integer)'::regprocedure), 'административный RPC с явной проверкой permissions');
select ok((select relrowsecurity from pg_class where oid='public.quests'::regclass), 'RLS квестов включена');
select ok(not has_function_privilege('anon','public.search_organization_quests(uuid,text,text,jsonb,integer)','execute'), 'анонимное выполнение запрещено');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok($$select pg_temp.quest_page()$$, '42501', 'organization quest access denied', 'чужой аккаунт не может искать');
reset role;
select ok((select proconfig @> array['search_path=pg_catalog, public'] from pg_proc where oid='public.search_organization_quests(uuid,text,text,jsonb,integer)'::regprocedure), 'фиксированный search_path');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='quests' and cmd in ('SELECT','ALL') and permissive='RESTRICTIVE'), 'контракт RPC: нет дополнительных restrictive read policies');
insert into public.organization_memberships (organization_id,user_id,status)
values (current_setting('test.ux03_org')::uuid,'91000000-0000-4000-8000-000000000003','active');
insert into public.membership_roles(membership_id,role_id)
select m.id,r.id from public.organization_memberships m cross join public.roles r
where m.organization_id=current_setting('test.ux03_org')::uuid and m.user_id='91000000-0000-4000-8000-000000000003' and r.key='host';
set local role authenticated;
select is(jsonb_array_length(pg_temp.quest_page()->'items'),25,'участник команды с quests.read может искать');
select is((select count(*) from public.quests where organization_id=current_setting('test.ux03_org')::uuid),9999::bigint,'RLS разрешает этой роли тот же набор организации');
reset role;
update public.organization_memberships set status='revoked' where organization_id=current_setting('test.ux03_org')::uuid and user_id='91000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select pg_temp.quest_page()$$, '42501', 'organization quest access denied', 'отозванная роль не может читать через RPC');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select pg_temp.quest_page()$$, '42501', 'authentication required', 'без auth.uid чтение запрещено');
reset role;
select * from finish();
rollback;
