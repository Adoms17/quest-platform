begin;
select no_plan();
-- Действующая публикация проверяется platform_tariff_publication.test.sql.
select ok(not has_function_privilege('authenticated','public.fix_platform_tariff_version(uuid,uuid,integer)','execute'),'старый этап закрыт для authenticated');
select ok(not has_function_privilege('anon','public.fix_platform_tariff_version(uuid,uuid,integer)','execute'),'старый этап закрыт для anon');
select ok(not has_table_privilege('authenticated','public.platform_fixed_tariff_versions','insert'),'прямая фиксация закрыта');
select throws_ok('update public.platform_fixed_tariff_versions set active_quests_limit=999','55000','billing plan versions are immutable','снимки неизменяемы');
select * from finish();rollback;
