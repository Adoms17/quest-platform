begin;
-- Новые trial выбирают актуальную версию. Исторический retry расположен раньше
-- проверки и не меняет уже выданный доступ или расход однократного права.
do $migration$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.request_organization_trial(uuid,uuid,text,uuid,bigint)'::regprocedure);
 marker:='select id into v_free from public.billing_plan_versions where plan_key=''free'' and version=1;';
 if position(marker in definition)=0 then raise exception 'trial Free marker missing'; end if;
 execute replace(definition,marker,
 'if not platform_private.tariff_allows_renewal(p.id,clock_timestamp(),false) then
 raise exception ''tariff version no longer current'' using errcode=''22023''; end if;
 v_free:=platform_private.current_tariff_version(''free'',clock_timestamp());');
 definition:=pg_get_functiondef('public.redeem_organization_promotion(uuid,text,uuid,bigint)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'promotion Free marker missing'; end if;
 execute replace(definition,marker,'v_free:=platform_private.current_tariff_version(''free'',clock_timestamp());');
 definition:=pg_get_functiondef('public.get_organization_free_access_controls(uuid,text)'::regprocedure);
 marker:='select distinct on(plan_key) * from public.billing_plan_versions where plan_key<>''free'' order by plan_key,version desc';
 if position(marker in definition)=0 then raise exception 'trial catalogue marker missing'; end if;
 execute replace(definition,marker,
 'select * from public.billing_plan_versions where plan_key<>''free'' and id=platform_private.current_tariff_version(plan_key,statement_timestamp())');
 definition:=pg_get_functiondef('public.effective_trial_subscription(public.organization_subscriptions,timestamptz)'::regprocedure);
 marker:='s.plan_version_id:=g.free_plan_version_id;';
 if position(marker in definition)=0 then raise exception 'effective Free marker missing'; end if;
 execute replace(definition,marker,
 's.plan_version_id:=platform_private.current_tariff_version(''free'',g.ends_at);
   if s.plan_version_id is null then raise exception ''free plan unavailable'' using errcode=''P0001''; end if;');
end;
$migration$;
commit;
