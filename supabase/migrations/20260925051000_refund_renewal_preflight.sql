begin;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.reserve_platform_subscription_refund(uuid)'::regprocedure);
 marker:='if found then return existing; end if;';
 if position(marker in definition)=0 then raise exception 'refund preflight marker missing'; end if;
 execute replace(definition,marker,marker||'
 if exists(select 1 from public.billing_recurring_orders ro join public.billing_recurring_dispatches d on d.order_id=ro.id
 where ro.organization_id=request.organization_id
 and not exists(select 1 from public.billing_period_confirmations c where c.confirmation_id=ro.id)
 and not exists(select 1 from public.billing_recurring_results p where p.order_id=ro.id and p.status=''canceled'' and not p.requires_review)) then
 raise exception ''subscription refund renewal reconciliation required'' using errcode=''55000''; end if;');
 definition:=pg_get_functiondef('platform_private.authorize_recurring_send(uuid,uuid)'::regprocedure);
 marker:='select * into a from public.billing_recurring_attempts where order_id=r.id;';
 if position(marker in definition)=0 then raise exception 'refund dispatch guard marker missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.subscription_refund_requests rq
 join public.subscription_refund_reservations l on l.request_id=rq.id
 join public.billing_sandbox_refunds f on f.id=l.refund_id
 where rq.organization_id=r.organization_id and f.state not in (''canceled'',''rejected'')
 and not exists(select 1 from public.subscription_refund_applications applied_refund where applied_refund.request_id=rq.id)) then return false; end if;
 '||marker);
end; $$;
commit;
