begin;
-- Extend the existing authorized/audited reads, without exposing IDs or receipt contacts.
do $$
declare definition text; marker text:='select f.id,f.created_at,f.amount_minor,f.state,c.reason_code,';
begin
 definition:=pg_get_functiondef('public.read_platform_order_refunds(uuid,uuid,uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'fiscal refund history marker missing'; end if;
 execute replace(definition,marker,marker||'
 (select jsonb_build_object(''state'',s.state,''receipt_status'',s.receipt_status,''requires_review'',s.requires_review)
  from public.billing_subscription_fiscal_operation_status s where s.command_id=f.fiscal_command_id) as fiscal,');
end; $$;
do $$
declare definition text; marker text:='), page as (';
begin
 definition:=pg_get_functiondef('public.read_platform_order_receipts(uuid,uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'fiscal receipt history marker missing'; end if;
 definition:=replace(definition,'where f.order_id=p_order_id','where f.order_id=p_order_id and f.fiscal_command_id is null');
 execute replace(definition,marker,'
 union all
 select case when x.kind=''settlement'' then ''settlement'' else ''refund'' end,x.command_id,x.amount_minor,
  coalesce(s.receipt_status,case when s.state=''reserved'' then ''prepared'' when x.kind=''settlement'' and s.state=''pending'' then ''pending'' else ''unknown'' end),
  x.created_at,s.checked_at,s.requires_review
 from public.billing_subscription_fiscal_operations x join public.billing_subscription_fiscal_operation_status s using(command_id)
 where x.order_id=p_order_id and (x.kind=''settlement'' or s.state not in (''canceled'',''rejected'') or s.provider_receipt_id is not null)
 '||marker);
end; $$;
commit;
