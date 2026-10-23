begin;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.sandbox_recurring_worker_command(uuid,text,uuid,jsonb)'::regprocedure);
 marker:='when ''begin'' then';
 if position(marker in definition)=0 then raise exception 'gateway marker missing'; end if;
 execute replace(definition,marker,'when ''apply'' then return platform_private.apply_recurring_period(p_order_id); '||marker);
 definition:=pg_get_functiondef('public.list_sandbox_recurring_work(text)'::regprocedure);
 marker:='p.status in (''pending'',''waiting_for_capture'')';
 if position(marker in definition)=0 then raise exception 'queue marker missing'; end if;
 definition:=replace(definition,marker,'p.status in (''pending'',''waiting_for_capture'',''succeeded'')');
 marker:='where source.shop_id=p_shop_id';
 if position(marker in definition)=0 then raise exception 'queue source marker missing'; end if;
 execute replace(definition,marker,marker||' and not exists(select 1 from public.billing_period_confirmations receipt where receipt.confirmation_id=r.id)');
end; $$;
commit;
