begin;
-- Preparation only. No scheduler or provider send is enabled by this migration.
create table public.billing_prepayment_settlements (
 order_id uuid primary key references public.billing_receipt_payment_requests(order_id),
 idempotency_key uuid not null unique default gen_random_uuid(),
 body jsonb not null,
 body_sha256 text not null,
 created_at timestamptz not null default statement_timestamp()
);
alter table public.billing_prepayment_settlements enable row level security;
revoke all on public.billing_prepayment_settlements from public,anon,authenticated,service_role;
create trigger prepayment_settlement_immutable before update or delete on public.billing_prepayment_settlements
 for each row execute function public.guard_fiscal_storage();

create function public.prepare_prepayment_settlement(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; p public.billing_sandbox_payment_results%rowtype;
 s public.billing_receipt_payment_status%rowtype; r public.billing_prepayment_settlements%rowtype;
 receipt jsonb; body jsonb;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found then raise exception 'settlement unavailable' using errcode='55000'; end if;
 select * into p from public.billing_sandbox_payment_results where order_id=o.id;
 select * into s from public.billing_receipt_payment_status where order_id=o.id;
 if p.status is distinct from 'succeeded' or p.paid is distinct from true
  or p.requires_review is distinct from false or p.shop_id is distinct from o.shop_id
  or s.status is distinct from 'succeeded' or s.payment_id is distinct from p.payment_id
  or exists(select 1 from public.billing_sandbox_refunds where order_id=o.id and state not in ('canceled','rejected')) then
  raise exception 'settlement unavailable' using errcode='55000'; end if;
 select * into r from public.billing_prepayment_settlements where order_id=o.id;
 if not found then
  select q.body->'receipt' into receipt from public.billing_receipt_payment_requests q where q.order_id=o.id;
  if receipt is null or jsonb_array_length(receipt->'items') is distinct from 1
   or receipt#>>'{items,0,payment_mode}' is distinct from 'full_prepayment' then
   raise exception 'settlement unavailable' using errcode='55000'; end if;
  body:=jsonb_build_object('type','payment','payment_id',p.payment_id,'send',true,
   'customer',receipt->'customer','items',jsonb_set(receipt->'items','{0,payment_mode}','"full_payment"'::jsonb),
   'settlements',jsonb_build_array(jsonb_build_object('type','prepayment','amount',receipt#>'{items,0,amount}')));
  insert into public.billing_prepayment_settlements(order_id,body,body_sha256)
   values(o.id,body,encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex')) returning * into r;
 end if;
 return jsonb_build_object('body',r.body,'key',r.idempotency_key,'sha256',r.body_sha256);
end; $$;
revoke all on function public.prepare_prepayment_settlement(uuid) from public,anon,authenticated;
grant execute on function public.prepare_prepayment_settlement(uuid) to service_role;
commit;
