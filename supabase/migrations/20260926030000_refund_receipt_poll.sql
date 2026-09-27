begin;
create function public.list_pending_refund_receipts(p_limit integer default 25,p_shop_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid receipt batch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
 select jsonb_build_object('order',jsonb_build_object('id',o.id,'organizationId',o.organization_id,'planVersionId',o.plan_version_id,
 'idempotencyKey',o.idempotency_key,'environment','sandbox','shopId',o.shop_id,'amountMinor',o.amount_minor,'currency',o.currency,
 'firstSentAt',o.first_sent_at,'providerPaymentId',f.payment_id),
 'refund',jsonb_build_object('id',f.id,'order_id',f.order_id,'payment_id',f.payment_id,'amount_minor',f.amount_minor,'first_sent_at',f.first_sent_at,
 'provider_refund_id',coalesce(s.provider_refund_id,f.provider_refund_id))) item
 from public.billing_refund_receipt_requests r join public.billing_sandbox_refunds f on f.id=r.refund_id
 join public.billing_sandbox_orders o on o.id=f.order_id left join public.billing_refund_receipt_status s on s.refund_id=f.id
 where (p_shop_id is null or o.shop_id=p_shop_id) and coalesce(s.status,'unknown') in ('unknown','pending')
 and coalesce(s.provider_refund_id,f.provider_refund_id) is not null
 order by coalesce(s.checked_at,r.created_at),f.id limit p_limit
 ) pending;
 return result;
end; $$;
revoke all on function public.list_pending_refund_receipts(integer,text) from public,anon,authenticated;
grant execute on function public.list_pending_refund_receipts(integer,text) to service_role;
commit;
