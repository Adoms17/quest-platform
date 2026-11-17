begin;
create function public.list_pending_recurring_receipts(p_limit integer default 25,p_shop_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid receipt batch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
 select platform_private.read_recurring_attempt(r.order_id)||jsonb_build_object('providerPaymentId',coalesce(s.payment_id,p.payment_id)) item
 from public.billing_recurring_receipt_requests r join public.billing_recurring_attempts a on a.order_id=r.order_id
 left join public.billing_recurring_receipt_status s on s.order_id=r.order_id
 left join public.billing_recurring_results p on p.order_id=r.order_id
 where (p_shop_id is null or a.shop_id=p_shop_id) and coalesce(s.status,'unknown') in ('unknown','pending')
 and coalesce(s.payment_id,p.payment_id) is not null
 order by coalesce(s.checked_at,r.created_at),r.order_id limit p_limit
 ) pending;
 return result;
end; $$;
revoke all on function public.list_pending_recurring_receipts(integer,text) from public,anon,authenticated;
grant execute on function public.list_pending_recurring_receipts(integer,text) to service_role;
commit;
