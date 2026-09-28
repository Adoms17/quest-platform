begin;
-- Separate bounded entry points; existing batch worker remains unchanged.
create function public.list_subscription_fiscal_order_work(p_shop_id text,p_target_order_id uuid,p_kind text,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_target_order_id is null or p_shop_id is null or p_shop_id !~ '^[0-9]+$' or p_kind is null or p_kind not in ('due','reconcile')
  or p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid fiscal batch' using errcode='22023'; end if;
 if p_kind='due' then
  select coalesce(jsonb_agg(v.item),'[]'::jsonb) into result from (
   select jsonb_build_object('orderId',o.id,'shopId',o.shop_id) item
   from public.billing_subscription_fiscal_ledgers l join public.billing_sandbox_orders o on o.id=l.order_id
   join public.billing_subscription_fiscal_terms t on t.order_id=o.id
   join public.billing_sandbox_application_scope a on a.organization_id=o.organization_id
   join public.billing_sandbox_payment_results p on p.order_id=o.id
   where o.id=p_target_order_id and o.shop_id=p_shop_id and t.period_end<=statement_timestamp() and p.status='succeeded' and p.paid and not p.requires_review
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
   select jsonb_build_object('commandId',x.command_id,'shopId',o.shop_id,'orderId',o.id) item
   from public.billing_subscription_fiscal_operations x join public.billing_subscription_fiscal_operation_status s using(command_id)
   join public.billing_sandbox_orders o on o.id=x.order_id
   join public.billing_sandbox_application_scope a on a.organization_id=o.organization_id
   where o.id=p_target_order_id and o.shop_id=p_shop_id and s.first_sent_at is not null and s.next_check_at<=statement_timestamp()
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
revoke all on function public.list_subscription_fiscal_order_work(text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_subscription_fiscal_order_work(text,uuid,text,integer) to service_role;


create function public.subscription_fiscal_order_worker_gateway(p_shop_id text,p_target_order_id uuid,p_action text,p_order_id uuid default null,p_command_id uuid default null,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_target_order_id is null or p_action is null or
  (p_action='claim_settlement' and p_order_id is distinct from p_target_order_id) or
  (p_action<>'claim_settlement' and not exists(select 1 from public.billing_subscription_fiscal_operations
   where command_id=p_command_id and order_id=p_target_order_id)) then
  raise exception 'fiscal worker target denied' using errcode='42501';
 end if;
 return public.subscription_fiscal_worker_gateway(p_shop_id,p_action,p_order_id,p_command_id,p_result);
end; $$;
revoke all on function public.subscription_fiscal_order_worker_gateway(text,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subscription_fiscal_order_worker_gateway(text,uuid,text,uuid,uuid,jsonb) to service_role;
commit;
