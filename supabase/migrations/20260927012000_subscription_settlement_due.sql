begin;
create or replace function public.prepare_prepayment_settlement(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; p public.billing_sandbox_payment_results%rowtype;
 s public.billing_receipt_payment_status%rowtype; r public.billing_prepayment_settlements%rowtype;
 receipt jsonb; body jsonb;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found then raise exception 'settlement unavailable' using errcode='55000'; end if;
 -- Check under the same order lock as refund reservation and first dispatch.
 -- Legacy operations keep their existing contract; automatic discovery below
 -- only includes explicitly modeled subscriptions.
 if exists(select 1 from public.billing_receipt_snapshots x
   join public.billing_fiscal_policy_models m on m.policy_id=x.policy_id where x.order_id=o.id)
  and not exists(select 1 from public.billing_subscription_fiscal_terms t
   join public.billing_receipt_snapshots x on x.order_id=t.order_id and x.policy_id=t.policy_id
   where t.order_id=o.id and t.period_end<=clock_timestamp()) then
  raise exception 'subscription settlement not due' using errcode='55000';
 end if;

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

-- Read-only work discovery. Claim rechecks all mutable conditions under lock;
-- listing does not reserve or authorize an HTTP request. No scheduler enabled.
create function public.list_due_subscription_settlements(p_shop_id text,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or p_limit is null or p_limit<1 or p_limit>100 then
  raise exception 'invalid settlement batch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(item order by due_at,order_id),'[]'::jsonb) into result from (
  select t.period_end due_at,o.id order_id,
   jsonb_build_object('orderId',o.id,'shopId',o.shop_id,'dueAt',t.period_end) item
  from public.billing_subscription_fiscal_terms t
  join public.billing_fiscal_policy_models m on m.policy_id=t.policy_id
  join public.billing_receipt_snapshots x on x.order_id=t.order_id and x.policy_id=t.policy_id
  join public.billing_sandbox_orders o on o.id=t.order_id
  join public.billing_sandbox_payment_results p on p.order_id=o.id
  join public.billing_receipt_payment_status s on s.order_id=o.id
  join public.billing_receipt_payment_requests q on q.order_id=o.id
  where o.shop_id=p_shop_id and t.period_end<=statement_timestamp()
   and m.product_kind='subscription' and m.model_version='subscription_access_v1' and m.settlement_basis='period_end'
   and p.status='succeeded' and p.paid and not p.requires_review and p.shop_id=o.shop_id
   and s.status='succeeded' and s.payment_id=p.payment_id
   and jsonb_array_length(q.body#>'{receipt,items}')=1
   and q.body#>>'{receipt,items,0,payment_mode}'='full_prepayment'
   and not exists(select 1 from public.billing_sandbox_refunds f where f.order_id=o.id and f.state not in ('canceled','rejected'))
   and not exists(select 1 from public.billing_prepayment_settlement_status st where st.order_id=o.id)
  order by t.period_end,o.id limit p_limit
 ) due;
 return result;
end; $$;
revoke all on function public.list_due_subscription_settlements(text,integer) from public,anon,authenticated;
grant execute on function public.list_due_subscription_settlements(text,integer) to service_role;

commit;
