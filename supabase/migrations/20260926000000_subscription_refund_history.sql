begin;
do $$
declare definition text; marker text:='select f.id,f.created_at,f.amount_minor,f.state,c.reason_code,';
begin
 definition:=pg_get_functiondef('public.read_platform_order_refunds(uuid,uuid,uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund history marker missing'; end if;
 execute replace(definition,marker,marker||'
   case when exists(select 1 from public.subscription_refund_reservations l where l.refund_id=f.id) then ''subscription'' else ''manual'' end as refund_kind,
   case when exists(select 1 from public.subscription_refund_reservations l where l.refund_id=f.id) then
    case when exists(select 1 from public.subscription_refund_applications a where a.refund_id=f.id) then
     case when f.state=''succeeded'' then ''applied'' else ''applied_review_required'' end
    when f.state in (''succeeded'',''review'') then ''review_required'' else ''not_applied'' end
   else ''unchanged'' end as access_state,');
end; $$;
commit;
