begin;
select no_plan();
-- Старая схема заменена скидками при покупке; положительные сценарии в billing_discount_*.
select is(to_regprocedure('public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid)'),null::regprocedure,'старый выпуск удалён');
select is(to_regprocedure('public.redeem_organization_promotion(uuid,text,uuid,bigint)'),null::regprocedure,'старый способ активации удалён');
select is(to_regprocedure('public.preview_organization_promotion(uuid,text)'),null::regprocedure,'старый preview удалён');
select is(to_regclass('public.billing_promotions'),null::regclass,'старый реестр удалён');
select ok(not has_table_privilege('authenticated','public.billing_discount_codes','select'),'коды новой схемы закрыты для клиента');
select ok((select relrowsecurity from pg_class where oid='public.billing_discount_codes'::regclass),'новые коды защищены RLS');
select * from finish();rollback;
