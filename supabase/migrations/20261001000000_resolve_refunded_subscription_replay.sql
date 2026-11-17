begin;
-- Called only after provider verification and under the event handler's order locks.
create function platform_private.subscription_refund_replay_resolved(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.billing_sandbox_orders o
  join public.billing_sandbox_payment_results p on p.order_id=o.id
  join public.subscription_refund_requests q on q.order_id=o.id and q.organization_id=o.organization_id
  join public.subscription_refund_period_bindings b on b.request_id=q.id
  join public.subscription_refund_reservations l on l.request_id=q.id
  join public.billing_sandbox_refunds f on f.id=l.refund_id and f.order_id=o.id
  join public.subscription_refund_applications a on a.request_id=q.id and a.refund_id=f.id and a.period_order_id=b.period_order_id
  where o.id=p_order_id and b.period_order_id=o.id and b.plan_version_id=o.plan_version_id
   and b.period_start=o.period_start and b.period_end=o.period_end and p.shop_id=o.shop_id and p.status='succeeded' and p.paid and not p.requires_review
   and f.state='succeeded' and f.provider_refund_id is not null and f.first_sent_at is not null
   and f.payment_id=p.payment_id and f.payment_id::text=q.snapshot->>'payment_id'
   and f.amount_minor=q.amount_minor and q.amount_minor>0
   and o.amount_minor=(q.snapshot->>'paid_minor')::bigint
   and exists(select 1 from public.billing_sandbox_application_scope s where s.organization_id=o.organization_id)
 );
$$;
revoke all on function platform_private.subscription_refund_replay_resolved(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.apply_sandbox_payment_event(uuid,jsonb)'::regprocedure);
 marker:='elsif r->>''status'' in (''succeeded'',''canceled'') and exists(select 1 from public.billing_discount_payment_links where payment_order_id=o.id) then';
 if position(marker in definition)=0 then raise exception 'refunded replay marker missing'; end if;
 execute replace(definition,marker,'elsif r->>''status''=''succeeded'' and platform_private.subscription_refund_replay_resolved(o.id) then
 v_state:=''not_paid'';v_reason:=''subscription_refunded'';
 update public.billing_sandbox_orders set state=''finished'' where id=o.id;
 '||marker);
 definition:=pg_get_functiondef('public.read_platform_organization_payments(uuid,uuid)'::regprocedure);
 marker:='''fully_refunded_trial_duplicate'')';
 if position(marker in definition)=0 then raise exception 'payment reason projection marker missing'; end if;
 execute replace(definition,marker,'''fully_refunded_trial_duplicate'',''subscription_refunded'')');
end; $$;
commit;
