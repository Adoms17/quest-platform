begin;
-- Internal lifecycle only. No executable gateway or provider dispatch is enabled.
alter table public.billing_subscription_fiscal_operation_status
 add column first_sent_at timestamptz,
 add column provider_refund_id uuid unique,
 add column provider_receipt_id text unique check(provider_receipt_id ~ '^r[at]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 add column checked_at timestamptz,
 add column requires_review boolean not null default false;

create function platform_private.guard_fiscal_operation_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.billing_sandbox_orders where id=new.order_id for update;
 if exists(select 1 from public.billing_subscription_fiscal_operations x
  join public.billing_subscription_fiscal_operation_status s using(command_id)
  where x.order_id=new.order_id and s.requires_review) then
  raise exception 'fiscal review required' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function platform_private.guard_fiscal_operation_review() from public,anon,authenticated,service_role;
create trigger fiscal_operation_review_guard before insert on public.billing_subscription_fiscal_operations
 for each row execute function platform_private.guard_fiscal_operation_review();

create function platform_private.claim_subscription_fiscal_operation(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x public.billing_subscription_fiscal_operations%rowtype;
 s public.billing_subscription_fiscal_operation_status%rowtype; o public.billing_sandbox_orders%rowtype;
 action text; payment uuid;
begin
 select * into x from public.billing_subscription_fiscal_operations where command_id=p_command_id;
 if not found then raise exception 'fiscal operation unavailable' using errcode='55000'; end if;
 select * into o from public.billing_sandbox_orders where id=x.order_id for update;
 select * into s from public.billing_subscription_fiscal_operation_status where command_id=x.command_id for update;
 if not found then raise exception 'fiscal operation unavailable' using errcode='55000'; end if;
 if exists(select 1 from public.billing_subscription_fiscal_operations q
  join public.billing_subscription_fiscal_operation_status t using(command_id)
  where q.order_id=x.order_id and t.requires_review) then return jsonb_build_object('action','review'); end if;
 select payment_id into payment from public.billing_subscription_fiscal_ledgers where order_id=x.order_id;
 if not exists(select 1 from public.billing_sandbox_payment_results p where p.order_id=o.id
  and p.payment_id=payment and p.shop_id=o.shop_id and p.status='succeeded' and p.paid and not p.requires_review) then
  raise exception 'fiscal payment unverified' using errcode='55000'; end if;
 if s.first_sent_at is null then
  if s.state<>'reserved' then raise exception 'fiscal claim invalid' using errcode='55000'; end if;
  update public.billing_subscription_fiscal_operation_status set state='unknown',first_sent_at=clock_timestamp()
   where command_id=x.command_id returning * into s;
  action:='send';
 else
  action:='reconcile';
  if s.provider_refund_id is null and s.provider_receipt_id is null
   and s.first_sent_at<=clock_timestamp()-interval '23 hours' then
   update public.billing_subscription_fiscal_operation_status set requires_review=true where command_id=x.command_id;
   return jsonb_build_object('action','review');
  end if;
 end if;
 return jsonb_build_object('action',action,'commandId',x.command_id,'orderId',x.order_id,'paymentId',payment,
  'shopId',o.shop_id,'kind',x.kind,'body',x.body,'key',x.idempotency_key,'sha256',x.body_sha256,
  'amountMinor',x.amount_minor,
  'expectedRefundedMinor',(select coalesce(sum(q.amount_minor),0) from public.billing_subscription_fiscal_operations q
   join public.billing_subscription_fiscal_operation_status t using(command_id)
   where q.order_id=x.order_id and q.expected_version<x.expected_version and q.kind<>'settlement' and t.state='succeeded'),
  'priorReceipts',(select coalesce(jsonb_agg(jsonb_build_object('id',t.provider_receipt_id,
   'type',case when q.kind='settlement' then 'payment' else 'refund' end,'refundId',t.provider_refund_id,
   'items',case when q.kind='settlement' then q.body->'items' else q.body#>'{receipt,items}' end,
   'settlements',case when q.kind='settlement' then q.body->'settlements' else null end) order by q.expected_version),'[]'::jsonb)
   from public.billing_subscription_fiscal_operations q join public.billing_subscription_fiscal_operation_status t using(command_id)
   where q.order_id=x.order_id and q.expected_version<x.expected_version and t.state='succeeded'),
  'firstSentAt',s.first_sent_at,'state',s.state,'refundId',s.provider_refund_id,'receiptId',s.provider_receipt_id);
end; $$;
revoke all on function platform_private.claim_subscription_fiscal_operation(uuid) from public,anon,authenticated,service_role;

-- Only a future trusted adapter may supply a verified, exact provider result.
-- Raw provider objects/contact data are never accepted by this interface.
create function platform_private.record_subscription_fiscal_result(
 p_command_id uuid,p_payment_id uuid,p_shop_id text,p_body_sha256 text,p_amount_minor bigint,
 p_state text,p_refund_id uuid,p_receipt_id text,p_receipt_status text) returns text
language plpgsql security definer set search_path='' as $$
declare x public.billing_subscription_fiscal_operations%rowtype;
 s public.billing_subscription_fiscal_operation_status%rowtype; shop text; payment uuid;
 next_receipt text; conflict boolean:=false;
begin
 select * into x from public.billing_subscription_fiscal_operations where command_id=p_command_id;
 if not found then raise exception 'fiscal operation unavailable' using errcode='55000'; end if;
 select shop_id into shop from public.billing_sandbox_orders where id=x.order_id for update;
 select * into s from public.billing_subscription_fiscal_operation_status where command_id=x.command_id for update;
 if not found or s.first_sent_at is null then raise exception 'fiscal send not claimed' using errcode='55000'; end if;
 if s.requires_review then return 'review'; end if;
 select payment_id into payment from public.billing_subscription_fiscal_ledgers where order_id=x.order_id;
 if p_payment_id is distinct from payment or p_shop_id is distinct from shop
  or p_body_sha256 is distinct from x.body_sha256 or p_amount_minor is distinct from x.amount_minor
  or p_state is null or p_state not in ('pending','succeeded','canceled')
  or (p_receipt_id is not null and p_receipt_id !~ '^r[at]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (x.kind='settlement' and (p_refund_id is not null or p_receipt_id is null))
  or (x.kind<>'settlement' and p_refund_id is null)
  or (p_state='succeeded' and (p_receipt_status is null or p_receipt_status not in ('unknown','pending','succeeded','canceled')))
  or (p_state<>'succeeded' and p_receipt_status is not null)
  or (p_state='succeeded' and p_receipt_status<>'unknown' and p_receipt_id is null)
  or (x.kind='settlement' and p_state='succeeded' and p_receipt_status is distinct from 'succeeded') then
  raise exception 'fiscal result invalid' using errcode='22023'; end if;
 conflict:=(s.provider_refund_id is not null and s.provider_refund_id is distinct from p_refund_id)
  or (s.provider_receipt_id is not null and p_receipt_id is not null and s.provider_receipt_id<>p_receipt_id)
  or (s.state in ('succeeded','canceled','rejected') and p_state in ('succeeded','canceled') and s.state<>p_state)
  or (s.receipt_status in ('succeeded','canceled') and p_receipt_status in ('succeeded','canceled') and s.receipt_status<>p_receipt_status);
 if coalesce(conflict,false) then
  update public.billing_subscription_fiscal_operation_status set requires_review=true,checked_at=clock_timestamp() where command_id=x.command_id;
  return 'review'; end if;
 -- Late pending/unknown must never undo a terminal monetary or receipt result.
 if s.state in ('succeeded','canceled','rejected') and p_state='pending' then return s.state; end if;
 next_receipt:=case when s.receipt_status in ('succeeded','canceled') then s.receipt_status
  when s.receipt_status='pending' and p_receipt_status='unknown' then s.receipt_status else p_receipt_status end;
 begin
  update public.billing_subscription_fiscal_operation_status set state=p_state,receipt_status=next_receipt,
   provider_refund_id=coalesce(s.provider_refund_id,p_refund_id),provider_receipt_id=coalesce(s.provider_receipt_id,p_receipt_id),
   checked_at=clock_timestamp(),requires_review=(next_receipt='canceled' or (x.kind='settlement' and p_state='canceled')) is true
   where command_id=x.command_id;
 exception when unique_violation then
  update public.billing_subscription_fiscal_operation_status set requires_review=true,checked_at=clock_timestamp() where command_id=x.command_id;
  return 'review';
 end;
 return case when next_receipt='canceled' or (x.kind='settlement' and p_state='canceled') then 'review' else p_state end;
end; $$;
revoke all on function platform_private.record_subscription_fiscal_result(uuid,uuid,text,text,bigint,text,uuid,text,text)
 from public,anon,authenticated,service_role;

create function platform_private.mark_subscription_fiscal_review(p_command_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if p_reason is null or p_reason not in ('provider_mismatch','unidentified_refund') then
  raise exception 'invalid fiscal review reason' using errcode='22023'; end if;
 select order_id into target from public.billing_subscription_fiscal_operations where command_id=p_command_id;
 if not found then raise exception 'fiscal operation unavailable' using errcode='55000'; end if;
 perform 1 from public.billing_sandbox_orders where id=target for update;
 update public.billing_subscription_fiscal_operation_status set requires_review=true,checked_at=clock_timestamp()
  where command_id=p_command_id;
 if not found then raise exception 'fiscal operation unavailable' using errcode='55000'; end if;
end; $$;
revoke all on function platform_private.mark_subscription_fiscal_review(uuid,text) from public,anon,authenticated,service_role;
commit;
