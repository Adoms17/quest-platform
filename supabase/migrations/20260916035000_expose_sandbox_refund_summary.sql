begin;
create or replace function public.get_sandbox_order_offer(p_organization_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; f public.billing_sandbox_fulfillments%rowtype; r public.billing_sandbox_payment_results%rowtype; refunds jsonb;
begin
 result:=public.get_sandbox_order_offer_before_fulfillment(p_organization_id,p_order_id);
 select * into f from public.billing_sandbox_fulfillments where order_id=p_order_id;
 select * into r from public.billing_sandbox_payment_results where order_id=p_order_id;
 select jsonb_build_object('refunded_minor',coalesce(sum(amount_minor) filter(where state='succeeded'),0),
 'refund_pending_minor',coalesce(sum(amount_minor) filter(where state in ('reserved','sending','pending')),0),
 'refund_requires_review',coalesce(bool_or(state='review'),false)) into refunds
 from public.billing_sandbox_refunds where order_id=p_order_id;
 return result||refunds||jsonb_build_object('fulfillment_state',coalesce(f.state,'none'),
 'payment_status',r.status,'payment_requires_review',coalesce(r.requires_review,false));
end;$$;
revoke all on function public.get_sandbox_order_offer(uuid,uuid) from public,anon;
grant execute on function public.get_sandbox_order_offer(uuid,uuid) to authenticated;
commit;
