begin;
create or replace function public.read_platform_order_receipts(p_organization_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare assignment uuid; items jsonb; total integer;
begin
 assignment:=public.require_platform_permission('billing.payment.read',p_organization_id);
 if not exists(select 1 from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id) then
  raise exception 'order unavailable' using errcode='42501'; end if;
 with records as (
 select 'payment'::text kind,s.order_id id,s.amount_minor,coalesce(p.status,case when r.order_id is null then 'prepared' else 'unknown' end) status,
 coalesce(r.created_at,s.prepared_at) created_at,p.checked_at,false review
 from public.billing_receipt_snapshots s left join public.billing_receipt_payment_requests r on r.order_id=s.order_id
 left join public.billing_receipt_payment_status p on p.order_id=s.order_id where s.order_id=p_order_id
 union all
 select 'renewal',s.order_id,s.amount_minor,coalesce(p.status,case when r.order_id is null then 'prepared' else 'unknown' end),coalesce(r.created_at,s.prepared_at),p.checked_at,false
 from public.billing_recurring_receipt_snapshots s left join public.billing_recurring_receipt_requests r on r.order_id=s.order_id
 left join public.billing_recurring_receipt_status p on p.order_id=s.order_id where s.order_id=p_order_id
 union all
 select 'refund',r.refund_id,f.amount_minor,coalesce(p.status,'unknown'),r.created_at,p.checked_at,false
 from public.billing_refund_receipt_requests r join public.billing_sandbox_refunds f on f.id=r.refund_id
 left join public.billing_refund_receipt_status p on p.refund_id=r.refund_id where f.order_id=p_order_id
 union all
 select 'settlement',r.order_id,o.amount_minor,coalesce(p.status,'prepared'),r.created_at,p.checked_at,coalesce(p.requires_review,false)
 from public.billing_prepayment_settlements r join public.billing_sandbox_orders o on o.id=r.order_id
 left join public.billing_prepayment_settlement_status p on p.order_id=r.order_id where r.order_id=p_order_id
 ), page as (
 select *,count(*) over() total from records order by created_at desc,id limit 100
 )
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'amountMinor',amount_minor,'status',status,'createdAt',created_at,'checkedAt',checked_at,
 'needsAttention',review or status='canceled' or (status in ('unknown','pending') and created_at<=statement_timestamp()-interval '3 days')) order by created_at desc,id),'[]'::jsonb),coalesce(max(page.total),0)
 into items,total from page;
 insert into public.platform_payment_read_events(actor_id,assignment_id,organization_id) values(auth.uid(),assignment,p_organization_id);
 return jsonb_build_object('items',items,'truncated',total>100,'measuredAt',statement_timestamp());
end; $$;
revoke all on function public.read_platform_order_receipts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_order_receipts(uuid,uuid) to authenticated;
commit;
