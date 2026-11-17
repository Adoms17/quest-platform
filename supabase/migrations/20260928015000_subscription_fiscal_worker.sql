begin;
alter table public.billing_subscription_fiscal_operation_status
 add column poll_failures integer not null default 0 check(poll_failures between 0 and 16),
 add column next_check_at timestamptz not null default '-infinity',
 add column last_polled_at timestamptz;

-- Only orders already owned by MODEL-03. Legacy orders keep their existing path.
create function public.list_subscription_fiscal_work(p_shop_id text,p_kind text,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or p_kind is null or p_kind not in ('due','reconcile')
  or p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid fiscal batch' using errcode='22023'; end if;
 if p_kind='due' then
  select coalesce(jsonb_agg(v.item),'[]'::jsonb) into result from (
   select jsonb_build_object('orderId',o.id,'shopId',o.shop_id) item
   from public.billing_subscription_fiscal_ledgers l join public.billing_sandbox_orders o on o.id=l.order_id
   join public.billing_subscription_fiscal_terms t on t.order_id=o.id
   join public.billing_sandbox_application_scope a on a.organization_id=o.organization_id
   join public.billing_sandbox_payment_results p on p.order_id=o.id
   where o.shop_id=p_shop_id and t.period_end<=statement_timestamp() and p.status='succeeded' and p.paid and not p.requires_review
    and p.payment_id=l.payment_id and p.shop_id=o.shop_id
    and l.amount_minor>(select coalesce(sum(x.amount_minor),0) from public.billing_subscription_fiscal_operations x
     join public.billing_subscription_fiscal_operation_status s using(command_id) where x.order_id=o.id and x.kind<>'settlement' and s.state='succeeded')
    and not exists(select 1 from public.billing_subscription_fiscal_operations x
     join public.billing_subscription_fiscal_operation_status s using(command_id) where x.order_id=o.id
      and (x.kind='settlement' or s.requires_review or s.state in ('reserved','unknown','pending') or (s.state='succeeded' and s.receipt_status<>'succeeded')))
    and not exists(select 1 from public.billing_prepayment_settlements where order_id=o.id)
   order by t.period_end,o.id limit p_limit
  ) v;
 else
  select coalesce(jsonb_agg(v.item),'[]'::jsonb) into result from (
   select jsonb_build_object('commandId',x.command_id,'shopId',o.shop_id) item
   from public.billing_subscription_fiscal_operations x join public.billing_subscription_fiscal_operation_status s using(command_id)
   join public.billing_sandbox_orders o on o.id=x.order_id
   join public.billing_sandbox_application_scope a on a.organization_id=o.organization_id
   where o.shop_id=p_shop_id and s.first_sent_at is not null and s.next_check_at<=statement_timestamp()
    and not exists(select 1 from public.billing_subscription_fiscal_operations q
     join public.billing_subscription_fiscal_operation_status z using(command_id) where q.order_id=o.id and z.requires_review)
    and (x.kind='settlement' or exists(select 1 from public.billing_sandbox_refunds f where f.fiscal_command_id=x.command_id))
    and (s.state in ('unknown','pending') or (s.state='succeeded' and (s.receipt_status in ('unknown','pending')
     or (x.kind<>'settlement' and not exists(select 1 from public.subscription_refund_applications where request_id=x.command_id)))))
   order by s.next_check_at,x.created_at,x.command_id limit p_limit
  ) v;
 end if;
 return result;
end; $$;
revoke all on function public.list_subscription_fiscal_work(text,text,integer) from public,anon,authenticated;
grant execute on function public.list_subscription_fiscal_work(text,text,integer) to service_role;

-- Worker identity is the authenticated service, never an actor supplied by a webhook.
-- Only claim_settlement can create work; read/record never claim or send a refund.
create function public.subscription_fiscal_worker_gateway(p_shop_id text,p_action text,p_order_id uuid default null,p_command_id uuid default null,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; x public.billing_subscription_fiscal_operations%rowtype;
 s public.billing_subscription_fiscal_operation_status%rowtype; result jsonb; remaining bigint; version bigint; state text; failures integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'fiscal worker requires read committed' using errcode='40001'; end if;
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or p_action is null
  or p_action not in ('claim_settlement','read','record','review','poll','before_send')
  or (p_action='claim_settlement' and (p_order_id is null or p_command_id is not null))
  or (p_action<>'claim_settlement' and (p_command_id is null or p_order_id is not null)) then
  raise exception 'invalid fiscal worker context' using errcode='42501'; end if;
 if p_action='claim_settlement' then select * into o from public.billing_sandbox_orders where id=p_order_id;
 else
  select * into x from public.billing_subscription_fiscal_operations where command_id=p_command_id;
  select * into o from public.billing_sandbox_orders where id=x.order_id;
 end if;
 if o.id is null or o.shop_id<>p_shop_id or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id)
  or not exists(select 1 from public.billing_subscription_fiscal_ledgers where order_id=o.id) then
  raise exception 'fiscal worker scope denied' using errcode='42501'; end if;
 perform 1 from public.organization_subscriptions where organization_id=o.organization_id for update;
 perform 1 from public.billing_sandbox_orders where id=o.id for update;
 if p_action='claim_settlement' then
  select * into x from public.billing_subscription_fiscal_operations where order_id=o.id and kind='settlement' order by expected_version limit 1;
  if not found then
   select l.amount_minor-coalesce((select sum(q.amount_minor) from public.billing_subscription_fiscal_operations q
    join public.billing_subscription_fiscal_operation_status z using(command_id) where q.order_id=o.id and q.kind<>'settlement' and z.state='succeeded'),0),l.version
    into remaining,version from public.billing_subscription_fiscal_ledgers l where l.order_id=o.id;
   perform platform_private.reserve_subscription_fiscal_operation(o.id,gen_random_uuid(),version,'settlement',remaining);
   select * into x from public.billing_subscription_fiscal_operations where order_id=o.id and kind='settlement';
  end if;
  return platform_private.claim_subscription_fiscal_operation(x.command_id)||jsonb_build_object('commandId',x.command_id);
 end if;
 select * into s from public.billing_subscription_fiscal_operation_status where command_id=x.command_id for update;
 if s.command_id is null or s.first_sent_at is null
  or (x.kind<>'settlement' and not exists(select 1 from public.billing_sandbox_refunds where fiscal_command_id=x.command_id)) then
  raise exception 'fiscal worker operation unavailable' using errcode='55000'; end if;
 if p_action='read' then
  result:=platform_private.claim_subscription_fiscal_operation(x.command_id);
  if result->>'action'='send' then raise exception 'worker cannot send refund' using errcode='55000'; end if;
  return result||jsonb_build_object('commandId',x.command_id);
 elsif p_action='record' then
  if p_result->>'commandId' is distinct from x.command_id::text or p_result->>'shopId' is distinct from p_shop_id then
   raise exception 'fiscal result invalid' using errcode='22023'; end if;
  if x.kind<>'settlement' then return platform_private.record_linked_subscription_fiscal_refund(x.command_id,p_result); end if;
  state:=platform_private.record_subscription_fiscal_result(x.command_id,(p_result->>'paymentId')::uuid,p_shop_id,
   p_result->>'bodySha256',(p_result->>'amountMinor')::bigint,p_result->>'state',(p_result->>'refundId')::uuid,p_result->>'receiptId',p_result->>'receiptStatus');
  return jsonb_build_object('state',state);
 elsif p_action='review' then
  perform platform_private.mark_subscription_fiscal_review(x.command_id,p_result->>'reason');
  return jsonb_build_object('state','review');
 elsif p_action='poll' then
  if jsonb_typeof(p_result->'resolved') is distinct from 'boolean' then raise exception 'invalid fiscal poll' using errcode='22023'; end if;
  failures:=case when (p_result->>'resolved')::boolean then 0 else least(s.poll_failures+1,16) end;
  update public.billing_subscription_fiscal_operation_status set poll_failures=failures,last_polled_at=clock_timestamp(),
   next_check_at=clock_timestamp()+make_interval(secs=>case when failures=0 then 300 else least(3600,60*power(2,failures-1))::integer end)
   where command_id=x.command_id;
  return jsonb_build_object('recorded',true);
 else
  if x.kind<>'settlement' or s.state<>'unknown' or s.requires_review or s.provider_receipt_id is not null
   or s.first_sent_at<=clock_timestamp()-interval '23 hours'
   or p_result->>'key' is distinct from x.idempotency_key::text or p_result->>'sha256' is distinct from x.body_sha256
   or (p_result->>'firstSentAt')::timestamptz is distinct from s.first_sent_at
   or not exists(select 1 from public.billing_subscription_fiscal_terms where order_id=o.id and period_end<=clock_timestamp())
   or exists(select 1 from public.billing_subscription_fiscal_operations q join public.billing_subscription_fiscal_operation_status z using(command_id) where q.order_id=o.id and z.requires_review)
   or not exists(select 1 from public.billing_sandbox_payment_results p join public.billing_subscription_fiscal_ledgers l on l.order_id=p.order_id
    where p.order_id=o.id and p.payment_id=l.payment_id and p.shop_id=p_shop_id and p.status='succeeded' and p.paid and not p.requires_review) then
   raise exception 'fiscal worker send denied' using errcode='55000'; end if;
  return jsonb_build_object('authorized',true,'commandId',x.command_id,'key',x.idempotency_key,'sha256',x.body_sha256);
 end if;
end; $$;
revoke all on function public.subscription_fiscal_worker_gateway(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subscription_fiscal_worker_gateway(text,text,uuid,uuid,jsonb) to service_role;

-- Prevent the old queues from selecting an order/refund owned by the new journal.
do $$
declare definition text; signature text;
begin
 definition:=pg_get_functiondef('public.list_due_subscription_settlements(text,integer)'::regprocedure);
 if position('where o.shop_id=p_shop_id' in definition)=0 then raise exception 'legacy due queue marker missing'; end if;
 execute replace(definition,'where o.shop_id=p_shop_id','where o.shop_id=p_shop_id and not exists(select 1 from public.billing_subscription_fiscal_ledgers where order_id=o.id)');
 foreach signature in array array['public.list_sandbox_refund_reconciliation(text)','public.list_sandbox_subscription_refund_applications(text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('where o.shop_id=p_shop_id' in definition)=0 then raise exception 'legacy refund queue marker missing'; end if;
  execute replace(definition,'where o.shop_id=p_shop_id','where o.shop_id=p_shop_id and f.fiscal_command_id is null');
 end loop;
end; $$;
commit;
