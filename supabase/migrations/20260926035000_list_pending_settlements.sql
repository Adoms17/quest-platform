begin;
create function public.list_pending_prepayment_settlements(p_shop_id text,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or p_limit is null or p_limit<1 or p_limit>100 then
  raise exception 'invalid settlement batch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
  select jsonb_build_object('orderId',s.order_id,'shopId',o.shop_id,'body',r.body,'receiptId',s.provider_receipt_id) item
  from public.billing_prepayment_settlement_status s
  join public.billing_prepayment_settlements r on r.order_id=s.order_id
  join public.billing_sandbox_orders o on o.id=s.order_id
  where o.shop_id=p_shop_id and not s.requires_review and s.status in ('unknown','pending')
  order by coalesce(s.checked_at,s.first_sent_at),s.order_id limit p_limit
 ) batch;
 return result;
end; $$;
revoke all on function public.list_pending_prepayment_settlements(text,integer) from public,anon,authenticated;
grant execute on function public.list_pending_prepayment_settlements(text,integer) to service_role;
commit;
