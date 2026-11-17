begin;
create table public.billing_prepayment_settlement_status (
 order_id uuid primary key references public.billing_prepayment_settlements(order_id),
 first_sent_at timestamptz not null default clock_timestamp(),
 provider_receipt_id text unique,
 status text not null default 'unknown' check(status in ('unknown','pending','succeeded','canceled')),
 checked_at timestamptz,
 requires_review boolean not null default false
);
alter table public.billing_prepayment_settlement_status enable row level security;
revoke all on public.billing_prepayment_settlement_status from public,anon,authenticated,service_role;

-- Serialize a first dispatch with refund reservation on the same order lock.
create function public.claim_prepayment_settlement(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prepared jsonb; s public.billing_prepayment_settlement_status%rowtype;
begin
 perform 1 from public.billing_sandbox_orders where id=p_order_id for update;
 if not found then raise exception 'settlement unavailable' using errcode='55000'; end if;
 select * into s from public.billing_prepayment_settlement_status where order_id=p_order_id;
 if found then
  select jsonb_build_object('body',r.body,'shopId',o.shop_id) into prepared
   from public.billing_prepayment_settlements r join public.billing_sandbox_orders o on o.id=r.order_id where r.order_id=p_order_id;
  return prepared||jsonb_build_object('action','reconcile','receiptId',s.provider_receipt_id,'status',s.status,'requiresReview',s.requires_review);
 end if;
 prepared:=public.prepare_prepayment_settlement(p_order_id);
 insert into public.billing_prepayment_settlement_status(order_id) values(p_order_id) returning * into s;
 return prepared||jsonb_build_object('action','send','firstSentAt',s.first_sent_at,'shopId',(select shop_id from public.billing_sandbox_orders where id=p_order_id));
end; $$;
revoke all on function public.claim_prepayment_settlement(uuid) from public,anon,authenticated;
grant execute on function public.claim_prepayment_settlement(uuid) to service_role;

create function public.record_prepayment_settlement(p_order_id uuid,p_receipt_id text,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.billing_prepayment_settlement_status%rowtype;
begin
 select * into s from public.billing_prepayment_settlement_status where order_id=p_order_id for update;
 if not found or p_receipt_id is null or p_receipt_id !~ '^rt-[a-zA-Z0-9-]{1,100}$'
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

-- Refund after settlement needs a different fiscal treatment. Keep it closed
-- until implemented, including unknown dispatch outcomes. No automatic unlock.
create function public.guard_refund_after_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state in ('canceled','rejected') then return new; end if;
 perform 1 from public.billing_sandbox_orders where id=new.order_id for update;
 if exists(select 1 from public.billing_prepayment_settlement_status where order_id=new.order_id) then
  raise exception 'refund after settlement requires review' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function public.guard_refund_after_settlement() from public,anon,authenticated,service_role;
create trigger refund_after_settlement_guard before insert or update on public.billing_sandbox_refunds
 for each row execute function public.guard_refund_after_settlement();
commit;
