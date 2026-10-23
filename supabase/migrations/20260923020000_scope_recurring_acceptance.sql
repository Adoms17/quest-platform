begin;
-- Отдельные RPC для приёмки: фильтр применяется до подготовки и захвата очереди.
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.prepare_due_sandbox_recurring(text)'::regprocedure);
 marker:='public.prepare_due_sandbox_recurring(p_shop_id text)';
 if position(marker in definition)=0 then raise exception 'prepare signature missing'; end if;
 definition:=replace(definition,marker,'public.prepare_scoped_sandbox_recurring(p_shop_id text, p_organization_id uuid)');
 marker:='where o.shop_id=p_shop_id';
 if position(marker in definition)=0 then raise exception 'prepare scope marker missing'; end if;
 definition:=replace(definition,marker,marker||' and c.organization_id=p_organization_id');
 execute definition;
 definition:=pg_get_functiondef('public.list_sandbox_recurring_work(text)'::regprocedure);
 marker:='public.list_sandbox_recurring_work(p_shop_id text)';
 if position(marker in definition)=0 then raise exception 'queue signature missing'; end if;
 definition:=replace(definition,marker,'public.list_scoped_sandbox_recurring_work(p_shop_id text, p_organization_id uuid)');
 marker:='where source.shop_id=p_shop_id';
 if position(marker in definition)=0 then raise exception 'queue scope marker missing'; end if;
 execute replace(definition,marker,marker||' and r.organization_id=p_organization_id');
end; $$;
revoke all on function public.prepare_scoped_sandbox_recurring(text,uuid) from public,anon,authenticated;
revoke all on function public.list_scoped_sandbox_recurring_work(text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_scoped_sandbox_recurring(text,uuid) to service_role;
grant execute on function public.list_scoped_sandbox_recurring_work(text,uuid) to service_role;
commit;
