begin;
-- Fiscal polling remains necessary after the monetary payment is terminal.
create function public.list_pending_sandbox_receipts(p_limit integer default 25,p_shop_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid receipt batch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
 select jsonb_build_object('id',o.id,'organizationId',o.organization_id,'planVersionId',o.plan_version_id,
 'idempotencyKey',o.idempotency_key,'amountMinor',o.amount_minor,'currency',o.currency,'shopId',o.shop_id,
 'environment','sandbox','firstSentAt',o.first_sent_at,'providerPaymentId',coalesce(s.payment_id,p.payment_id)) item
 from public.billing_receipt_payment_requests r join public.billing_sandbox_orders o on o.id=r.order_id
 left join public.billing_receipt_payment_status s on s.order_id=o.id
 left join public.billing_sandbox_payment_results p on p.order_id=o.id
 where (p_shop_id is null or o.shop_id=p_shop_id) and coalesce(s.status,'unknown') in ('unknown','pending') and coalesce(s.payment_id,p.payment_id) is not null
 order by coalesce(s.checked_at,r.created_at),o.id limit p_limit
 ) pending;
 return result;
end; $$;
revoke all on function public.list_pending_sandbox_receipts(integer,text) from public,anon,authenticated;
grant execute on function public.list_pending_sandbox_receipts(integer,text) to service_role;
commit;
