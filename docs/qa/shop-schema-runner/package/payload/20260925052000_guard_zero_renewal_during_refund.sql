begin;
-- Zero-cost renewals do not use dispatch authorization; guard their access application too.
do $$
declare definition text; marker text:='select * into p from public.billing_recurring_results where order_id=r.id;';
begin
 definition:=pg_get_functiondef('platform_private.apply_recurring_period(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'zero renewal refund guard marker missing'; end if;
 execute replace(definition,marker,'if not exists(select 1 from public.billing_period_confirmations confirmed where confirmed.confirmation_id=r.id)
 and exists(select 1 from public.subscription_refund_requests rq
 join public.subscription_refund_reservations l on l.request_id=rq.id
 join public.billing_sandbox_refunds f on f.id=l.refund_id
 where rq.organization_id=r.organization_id and f.state not in (''canceled'',''rejected'')
 and not exists(select 1 from public.subscription_refund_applications applied_refund where applied_refund.request_id=rq.id)) then
 return jsonb_build_object(''state'',''requires_review'',''reason'',''subscription_refund_pending''); end if;
 '||marker);
end; $$;
commit;
