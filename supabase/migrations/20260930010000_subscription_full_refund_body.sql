begin;
-- Expected receipt lines remain separate from the exact provider request body.
-- Historical request bodies and hashes are never rewritten or backfilled.
create function platform_private.subscription_fiscal_expected_items(p_command_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare x public.billing_subscription_fiscal_operations%rowtype; source_items jsonb; paid bigint;
begin
 select * into x from public.billing_subscription_fiscal_operations where command_id=p_command_id;
 if not found then raise exception 'fiscal operation unavailable' using errcode='55000'; end if;
 if x.kind='settlement' then return x.body->'items'; end if;
 if x.body ? 'receipt' then return x.body#>'{receipt,items}'; end if;
 select amount_minor into paid from public.billing_subscription_fiscal_ledgers where order_id=x.order_id;
 if x.amount_minor is distinct from paid or x.quantity_units<>1000000 then
  raise exception 'fiscal full refund invalid' using errcode='55000'; end if;
 select body#>'{receipt,items}' into source_items from public.billing_receipt_payment_requests where order_id=x.order_id;
 if jsonb_typeof(source_items) is distinct from 'array' or jsonb_array_length(source_items)<>1 then
  raise exception 'fiscal source receipt invalid' using errcode='55000'; end if;
 return jsonb_build_array((source_items->0)||jsonb_build_object('quantity','1.000000',
  'payment_mode',case when x.kind='refund_after' then 'full_payment' else 'full_prepayment' end));
end; $$;
revoke all on function platform_private.subscription_fiscal_expected_items(uuid) from public,anon,authenticated,service_role;

create or replace function platform_private.reserve_subscription_fiscal_operation(
 p_order_id uuid,p_command_id uuid,p_expected_version bigint,p_kind text,p_amount_minor bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; p public.billing_sandbox_payment_results%rowtype;
 l public.billing_subscription_fiscal_ledgers%rowtype; saved public.billing_subscription_fiscal_operations%rowtype;
 r record; receipt jsonb; item jsonb; body jsonb; quantity text; mode text; operation_kind text;
 refunded bigint:=0; refunded_units bigint:=0; remaining bigint; available_units bigint;
 count_units bigint; settled boolean:=false; reserved boolean:=false;
 total numeric; original_amount jsonb; target_amount jsonb;
begin
 if p_order_id is null or p_command_id is null or p_expected_version is null or p_expected_version<0
  or p_expected_version>=9007199254740991 or p_kind is null or p_kind not in ('refund','settlement')
  or p_amount_minor is null or p_amount_minor<1 or p_amount_minor>9007199254740991 then
  raise exception 'invalid fiscal command' using errcode='22023'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found then raise exception 'fiscal order unavailable' using errcode='55000'; end if;
 select * into saved from public.billing_subscription_fiscal_operations where command_id=p_command_id;
 if found then
  if saved.order_id<>p_order_id or saved.expected_version<>p_expected_version or saved.amount_minor<>p_amount_minor
   or (saved.kind='settlement')<>(p_kind='settlement') then
   raise exception 'fiscal command conflict' using errcode='22023'; end if;
  return jsonb_build_object('commandId',saved.command_id,'expectedVersion',saved.expected_version,'kind',saved.kind,
   'amountMinor',saved.amount_minor,'body',saved.body,'key',saved.idempotency_key,'sha256',saved.body_sha256);
 end if;
 -- Historical legacy fiscal operations are not silently imported into this ledger.
 if exists(select 1 from public.billing_sandbox_refunds f where f.order_id=o.id and f.fiscal_command_id is not null
  and not exists(select 1 from public.billing_subscription_fiscal_operations x
   join public.billing_subscription_fiscal_operation_status s using(command_id)
   join public.billing_subscription_fiscal_ledgers linked_ledger on linked_ledger.order_id=x.order_id
   where x.command_id=f.fiscal_command_id and x.order_id=f.order_id and x.amount_minor=f.amount_minor
    and linked_ledger.payment_id=f.payment_id and x.kind<>'settlement'
    and (f.state=s.state or (f.state='sending' and s.state='unknown')))) then
  raise exception 'linked fiscal money state mismatch' using errcode='55000'; end if;
 if exists(select 1 from public.billing_sandbox_refunds where order_id=o.id and fiscal_command_id is null and state not in ('canceled','rejected'))
  or exists(select 1 from public.billing_prepayment_settlements where order_id=o.id) then
  raise exception 'legacy fiscal operation exists' using errcode='55000'; end if;
 select * into p from public.billing_sandbox_payment_results where order_id=o.id;
 if p.status is distinct from 'succeeded' or p.paid is distinct from true or p.requires_review is distinct from false
  or p.shop_id is distinct from o.shop_id or o.currency is distinct from 'RUB'
  or o.amount_minor not between 1 and 9007199254740991
  or not exists(select 1 from public.billing_receipt_payment_status s where s.order_id=o.id
   and s.payment_id=p.payment_id and s.status='succeeded')
  or not exists(select 1 from public.billing_subscription_fiscal_terms t join public.billing_receipt_snapshots x
   on x.order_id=t.order_id and x.policy_id=t.policy_id join public.billing_fiscal_policy_models m on m.policy_id=t.policy_id
   where t.order_id=o.id and x.amount_minor=o.amount_minor and x.currency=o.currency
    and m.model_version='subscription_access_v1') then
  raise exception 'fiscal payment unverified' using errcode='55000'; end if;
 if p_kind='settlement' and not exists(select 1 from public.billing_subscription_fiscal_terms
  where order_id=o.id and period_end<=clock_timestamp()) then
  raise exception 'subscription settlement not due' using errcode='55000'; end if;
 select q.body->'receipt' into receipt from public.billing_receipt_payment_requests q where q.order_id=o.id;
 original_amount:=jsonb_build_object('value',(o.amount_minor/100)::text||'.'||lpad((o.amount_minor%100)::text,2,'0'),'currency','RUB');
 if receipt is null or jsonb_typeof(receipt->'items') is distinct from 'array'
  or jsonb_array_length(receipt->'items') is distinct from 1
  or receipt#>>'{items,0,payment_mode}' is distinct from 'full_prepayment'
  or receipt#>>'{items,0,payment_subject}' is distinct from 'service'
  or coalesce(receipt#>>'{items,0,quantity}','') not in ('1','1.000','1.000000')
  or receipt#>'{items,0,amount}' is distinct from original_amount then
  raise exception 'fiscal source receipt invalid' using errcode='55000'; end if;
 select * into l from public.billing_subscription_fiscal_ledgers where order_id=o.id;
 if not found then
  if p_expected_version<>0 then raise exception 'fiscal version changed' using errcode='55000'; end if;
  insert into public.billing_subscription_fiscal_ledgers(order_id,payment_id,amount_minor)
   values(o.id,p.payment_id,o.amount_minor) returning * into l;
 end if;
 if l.version<>p_expected_version or l.payment_id<>p.payment_id or l.amount_minor<>o.amount_minor then
  raise exception 'fiscal version changed' using errcode='55000'; end if;
 for r in select x.*,s.state,s.receipt_status from public.billing_subscription_fiscal_operations x
  left join public.billing_subscription_fiscal_operation_status s on s.command_id=x.command_id
  where x.order_id=o.id order by x.expected_version loop
  if r.state is null or r.state in ('reserved','unknown','pending')
   or (r.state='succeeded' and r.receipt_status<>'succeeded')
   or (r.kind='settlement' and r.state in ('canceled','rejected')) then reserved:=true; end if;
  if r.state='succeeded' then
   if r.kind='settlement' then settled:=true;
   else refunded:=refunded+r.amount_minor; refunded_units:=refunded_units+r.quantity_units; end if;
  end if;
 end loop;
 if reserved then raise exception 'fiscal operation unresolved' using errcode='55000'; end if;
 remaining:=o.amount_minor-refunded; available_units:=1000000-refunded_units;
 if remaining<=0 or available_units<=0 or refunded<0 or refunded_units<0
  or p_amount_minor>remaining or (p_kind='settlement' and (settled or p_amount_minor<>remaining)) then
  raise exception 'fiscal amount unavailable' using errcode='55000'; end if;
 if p_kind='refund' and p_amount_minor<remaining and (p_amount_minor<100 or remaining-p_amount_minor<100) then
  raise exception 'fiscal refund limits' using errcode='22023'; end if;
 -- numeric intermediates avoid overflowing bigint during multiplication.
 total:=o.amount_minor::numeric;
 count_units:=case when p_amount_minor=remaining then available_units
  else floor((2*p_amount_minor::numeric*1000000+total)/(2*total))::bigint end;
 if count_units<1 or count_units>available_units
  or floor((2*total*count_units+1000000)/2000000)<>p_amount_minor
  or floor((2*total*(available_units-count_units)+1000000)/2000000)<>remaining-p_amount_minor then
  raise exception 'fiscal quantity unrepresentable' using errcode='22023'; end if;
 mode:=case when p_kind='settlement' or settled then 'full_payment' else 'full_prepayment' end;
 operation_kind:=case when p_kind='settlement' then 'settlement' when settled then 'refund_after' else 'refund_before' end;
 quantity:=(count_units/1000000)::text||'.'||lpad((count_units%1000000)::text,6,'0');
 item:=(receipt->'items'->0)||jsonb_build_object('quantity',quantity,'payment_mode',mode);
 target_amount:=jsonb_build_object('value',(p_amount_minor/100)::text||'.'||lpad((p_amount_minor%100)::text,2,'0'),'currency','RUB');
 body:=case when p_kind='settlement' then jsonb_build_object('type','payment','payment_id',p.payment_id,'send',true,
  'customer',receipt->'customer','items',jsonb_build_array(item),'settlements',jsonb_build_array(jsonb_build_object('type','prepayment','amount',target_amount)))
 when p_amount_minor=o.amount_minor then jsonb_build_object('payment_id',p.payment_id,'amount',target_amount)
 else jsonb_build_object('payment_id',p.payment_id,'amount',target_amount,
  'receipt',jsonb_build_object('customer',receipt->'customer','items',jsonb_build_array(item))) end;
 insert into public.billing_subscription_fiscal_operations(command_id,order_id,expected_version,kind,amount_minor,quantity_units,body,body_sha256)
 values(p_command_id,o.id,l.version,operation_kind,p_amount_minor,count_units,body,
  encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex')) returning * into saved;
 insert into public.billing_subscription_fiscal_operation_status(command_id) values(p_command_id);
 update public.billing_subscription_fiscal_ledgers set version=version+1 where order_id=o.id;
 return jsonb_build_object('commandId',saved.command_id,'expectedVersion',saved.expected_version,'kind',saved.kind,
  'amountMinor',saved.amount_minor,'body',saved.body,'key',saved.idempotency_key,'sha256',saved.body_sha256);
end; $$;
revoke all on function platform_private.reserve_subscription_fiscal_operation(uuid,uuid,bigint,text,bigint)
 from public,anon,authenticated,service_role;

create or replace function platform_private.claim_subscription_fiscal_operation(p_command_id uuid) returns jsonb
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
  'amountMinor',x.amount_minor,'expectedItems',platform_private.subscription_fiscal_expected_items(x.command_id),
  'expectedRefundedMinor',(select coalesce(sum(q.amount_minor),0) from public.billing_subscription_fiscal_operations q
   join public.billing_subscription_fiscal_operation_status t using(command_id)
   where q.order_id=x.order_id and q.expected_version<x.expected_version and q.kind<>'settlement' and t.state='succeeded'),
  'priorReceipts',(select coalesce(jsonb_agg(jsonb_build_object('id',t.provider_receipt_id,
   'type',case when q.kind='settlement' then 'payment' else 'refund' end,'refundId',t.provider_refund_id,
   'items',platform_private.subscription_fiscal_expected_items(q.command_id),
   'settlements',case when q.kind='settlement' then q.body->'settlements' else null end) order by q.expected_version),'[]'::jsonb)
   from public.billing_subscription_fiscal_operations q join public.billing_subscription_fiscal_operation_status t using(command_id)
   where q.order_id=x.order_id and q.expected_version<x.expected_version and t.state='succeeded'),
  'firstSentAt',s.first_sent_at,'state',s.state,'refundId',s.provider_refund_id,'receiptId',s.provider_receipt_id);
end; $$;
revoke all on function platform_private.claim_subscription_fiscal_operation(uuid) from public,anon,authenticated,service_role;


commit;
