begin;
-- Новая ручная покупка выбирает актуальную версию. Идемпотентный повтор
-- уже принятого заказа возвращается раньше этой проверки: его условия сохранены.
do $migration$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.reserve_sandbox_payment_order(uuid,uuid,bigint,uuid,bigint,text,text,timestamptz,timestamptz)'::regprocedure);
 marker:='if exists(select 1 from public.billing_sandbox_orders where organization_id=p_organization_id and state<>''finished'') then';
 if position(marker in definition)=0 then raise exception 'sandbox reservation marker missing'; end if;
 execute replace(definition,marker,
 'if not platform_private.tariff_allows_renewal(p_plan_version_id,clock_timestamp(),false) then
   raise exception ''tariff version no longer current'' using errcode=''22023''; end if;
 '||marker);
 definition:=pg_get_functiondef('public.list_sandbox_checkout_offers(uuid)'::regprocedure);
 marker:='and q.expected_revision=s.revision and s.status<>''transition'' and p.plan_key<>''free''';
 if position(marker in definition)=0 then raise exception 'sandbox offer list marker missing'; end if;
 execute replace(definition,marker||chr(10),marker||chr(10)||
 '   and platform_private.tariff_allows_renewal(q.plan_version_id,statement_timestamp(),false)'||chr(10));
end;
$migration$;
commit;
