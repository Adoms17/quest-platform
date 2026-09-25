begin;
alter table public.subscription_refund_dispatches add column request_snapshot jsonb;
do $$
declare definition text; marker text:='insert into public.subscription_refund_dispatches(refund_id,actor_id) values(refund.id,auth.uid())';
begin
 definition:=pg_get_functiondef('platform_private.claim_subscription_refund_dispatch(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund request snapshot marker missing'; end if;
 execute replace(definition,marker,'insert into public.subscription_refund_dispatches(refund_id,actor_id,request_snapshot) values(refund.id,auth.uid(),jsonb_build_object(''refund_id'',refund.id,''idempotency_key'',refund.id,''payment_id'',refund.payment_id,''amount_minor'',refund.amount_minor,''currency'',order_row.currency,''shop_id'',order_row.shop_id))');
end; $$;
-- Recovery is a closed decision endpoint; the eventual sender must check valid_until again.
create function platform_private.prepare_subscription_refund_recovery(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.subscription_refund_requests%rowtype; refund public.billing_sandbox_refunds%rowtype;
 order_row public.billing_sandbox_orders%rowtype; authorized timestamptz; payload jsonb;
begin
 perform public.require_platform_owner();
 select r.* into request from public.subscription_refund_requests r join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id=p_refund_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 perform 1 from public.organization_subscriptions where organization_id=request.organization_id for update;
 select * into order_row from public.billing_sandbox_orders where id=request.order_id for update;
 select * into refund from public.billing_sandbox_refunds where id=p_refund_id for update;
 select authorized_at,request_snapshot into authorized,payload from public.subscription_refund_dispatches where refund_id=refund.id;
 if authorized is null or authorized is distinct from refund.first_sent_at
 or refund.order_id<>request.order_id or refund.amount_minor<>request.amount_minor
 or refund.payment_id::text is distinct from request.snapshot->>'payment_id'
 or order_row.organization_id<>request.organization_id or order_row.currency<>'RUB'
 or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=request.organization_id) then
 raise exception 'subscription refund recovery unavailable' using errcode='55000'; end if;
 if payload is distinct from jsonb_build_object('refund_id',refund.id,'idempotency_key',refund.id,'payment_id',refund.payment_id,'amount_minor',refund.amount_minor,'currency',order_row.currency,'shop_id',order_row.shop_id) then return jsonb_build_object('action','manual_review'); end if;
 if refund.state='review' then return jsonb_build_object('action','manual_review'); end if;
 if refund.provider_refund_id is not null then
  return jsonb_build_object('action','read_provider','refund_id',refund.id,'provider_refund_id',refund.provider_refund_id,'shop_id',order_row.shop_id);
 end if;
 if refund.state<>'sending' or clock_timestamp()<authorized or clock_timestamp()>=authorized+interval '23 hours' then
  return jsonb_build_object('action','manual_review'); end if;
 return jsonb_build_object('action','retry_same_request','refund_id',refund.id,'idempotency_key',refund.id,
 'payment_id',refund.payment_id,'amount_minor',refund.amount_minor,'currency',order_row.currency,'shop_id',order_row.shop_id,
 'valid_until',authorized+interval '23 hours');
end; $$;
revoke all on function platform_private.prepare_subscription_refund_recovery(uuid) from public,anon,authenticated,service_role;
commit;
