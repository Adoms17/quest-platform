begin;
-- Receipt only: no provider call, money reservation or access change.
create table public.subscription_refund_requests (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id),
 command_id uuid not null,
 organization_id uuid not null references public.organizations(id),
 order_id uuid not null unique references public.billing_sandbox_orders(id),
 requested_at timestamptz not null,
 policy text not null check(policy='subscription-prorata-v1'),
 snapshot jsonb not null,
 amount_minor bigint not null check(amount_minor>=0),
 unique(actor_id,command_id)
);
alter table public.subscription_refund_requests enable row level security;
revoke all on public.subscription_refund_requests from public,anon,authenticated,service_role;
create trigger subscription_refund_request_immutable before update or delete or truncate
 on public.subscription_refund_requests for each statement execute function public.prevent_billing_plan_version_mutation();

create function public.request_platform_subscription_refund(p_organization_id uuid,p_order_id uuid,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.subscription_refund_requests%rowtype;
 o public.billing_sandbox_orders%rowtype; payment public.billing_sandbox_payment_results%rowtype;
 at_time timestamptz; start_ms numeric; end_ms numeric; at_ms numeric;
 refunded bigint; pending bigint; amount bigint; entitled bigint; result public.subscription_refund_requests%rowtype;
begin
 perform public.require_platform_owner();
 if p_organization_id is null or p_order_id is null or p_command_id is null then
  raise exception 'invalid subscription refund request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':subscription-refund:'||p_command_id::text,0));
 select * into prior from public.subscription_refund_requests where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.order_id<>p_order_id or prior.organization_id<>p_organization_id then
   raise exception 'subscription refund request conflict' using errcode='22023'; end if;
  return to_jsonb(prior)||jsonb_build_object('state','requested','reserved',false,'access_effect','unchanged');
 end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not found or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then
  raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
 select * into prior from public.subscription_refund_requests where order_id=o.id;
 if found then return to_jsonb(prior)||jsonb_build_object('state','requested','reserved',false,'access_effect','unchanged'); end if;
 select * into payment from public.billing_sandbox_payment_results where order_id=o.id;
 if payment.order_id is null or payment.status<>'succeeded' or not payment.paid or payment.requires_review then
  raise exception 'sandbox payment not refundable' using errcode='22023'; end if;
 if o.period_start is null or o.period_end is null or not isfinite(o.period_start) or not isfinite(o.period_end)
  or o.period_end<=o.period_start or o.currency<>'RUB' then
  raise exception 'invalid refund period' using errcode='22023'; end if;
 select coalesce(sum(amount_minor) filter(where state='succeeded'),0),
  coalesce(sum(amount_minor) filter(where state not in ('succeeded','canceled','rejected')),0)
 into refunded,pending from public.billing_sandbox_refunds where order_id=o.id;
 if pending>0 then raise exception 'subscription refund pending' using errcode='55000'; end if;
 if refunded>o.amount_minor then raise exception 'invalid refund balance' using errcode='22023'; end if;
 at_time:=date_trunc('milliseconds',clock_timestamp());
 start_ms:=floor(extract(epoch from o.period_start)*1000);
 end_ms:=floor(extract(epoch from o.period_end)*1000);
 at_ms:=floor(extract(epoch from at_time)*1000);
 if end_ms<=start_ms then raise exception 'invalid refund period' using errcode='22023'; end if;
 entitled:=round(o.amount_minor::numeric*greatest(0,least(end_ms-start_ms,end_ms-at_ms))/(end_ms-start_ms));
 amount:=least(entitled,o.amount_minor-refunded);
 insert into public.subscription_refund_requests(actor_id,command_id,organization_id,order_id,requested_at,policy,snapshot,amount_minor)
 values(auth.uid(),p_command_id,p_organization_id,o.id,at_time,'subscription-prorata-v1',
  jsonb_build_object('payment_id',payment.payment_id,'paid_minor',o.amount_minor,'refunded_minor',refunded,
   'period_start',o.period_start,'period_end',o.period_end,'entitlement_minor',entitled,'currency',o.currency),amount)
 returning * into result;
 return to_jsonb(result)||jsonb_build_object('state','requested','reserved',false,'access_effect','unchanged');
end; $$;
-- No caller is enabled until reservation and period binding are implemented.
revoke all on function public.request_platform_subscription_refund(uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;
