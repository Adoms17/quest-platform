begin;
-- A dispatched renewal may already have charged money. Preserve access for review.
do $$
declare definition text; marker text:='or s.scheduled_plan_version_id is not null';
begin
 definition:=pg_get_functiondef('platform_private.apply_current_subscription_refund(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund recurring guard marker missing'; end if;
 execute replace(definition,marker,marker||'
  or exists(select 1 from public.billing_recurring_orders ro
   join public.billing_recurring_dispatches d on d.order_id=ro.id
   where ro.organization_id=r.organization_id
   and not exists(select 1 from public.billing_period_confirmations c where c.confirmation_id=ro.id)
   and not exists(select 1 from public.billing_recurring_results p where p.order_id=ro.id and p.status=''canceled'' and not p.requires_review))');
end; $$;
commit;
