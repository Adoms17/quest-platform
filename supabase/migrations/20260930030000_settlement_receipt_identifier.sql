begin;
-- YooKassa receipt identifiers include ra- as well as rt-.
create or replace function public.record_prepayment_settlement(p_order_id uuid,p_receipt_id text,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.billing_prepayment_settlement_status%rowtype;
begin
 select * into s from public.billing_prepayment_settlement_status where order_id=p_order_id for update;
 if not found or p_receipt_id is null or p_receipt_id !~ '^r[at]-[a-zA-Z0-9-]{1,100}$'
  or p_status is null or p_status not in ('pending','succeeded','canceled') then
  raise exception 'invalid settlement result' using errcode='22023'; end if;
 if s.provider_receipt_id is not null and s.provider_receipt_id<>p_receipt_id then
  update public.billing_prepayment_settlement_status set requires_review=true where order_id=p_order_id;
  return;
 end if;
 if s.status in ('succeeded','canceled') and s.status<>p_status then
  if p_status in ('succeeded','canceled') then
   update public.billing_prepayment_settlement_status set requires_review=true where order_id=p_order_id;
  end if;
  return;
 end if;
 update public.billing_prepayment_settlement_status set provider_receipt_id=p_receipt_id,status=p_status,checked_at=clock_timestamp() where order_id=p_order_id;
end; $$;
revoke all on function public.record_prepayment_settlement(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_prepayment_settlement(uuid,text,text) to service_role;

commit;
