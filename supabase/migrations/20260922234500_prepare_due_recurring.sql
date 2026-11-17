begin;
create function public.prepare_due_sandbox_recurring(p_shop_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; prepared integer:=0; skipped integer:=0;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 for item in
  select c.id,s.period_end,s.revision
  from public.billing_recurring_consents c
  join public.billing_recurring_methods m on m.consent_id=c.id
  join public.billing_sandbox_orders o on o.id=c.order_id
  join public.billing_sandbox_offers offer on offer.id=o.offer_id
  join public.organization_subscriptions s on s.organization_id=c.organization_id
  where o.shop_id=p_shop_id and s.status='active' and not s.cancel_at_period_end
   and s.plan_version_id=o.plan_version_id and s.period_end<=statement_timestamp()
   and (((s.period_end at time zone 'Europe/Moscow')+make_interval(months=>offer.period_months)) at time zone 'Europe/Moscow')>statement_timestamp()
   and exists(select 1 from public.billing_sandbox_application_scope where organization_id=c.organization_id)
   and not exists(select 1 from public.billing_recurring_revocations where consent_id=c.id)
   and not exists(select 1 from public.billing_recurring_orders where organization_id=c.organization_id and period_start=s.period_end)
   and not exists(select 1 from public.billing_discount_reservations where organization_id=c.organization_id and state='reserved')
   and not exists(select 1 from public.billing_sandbox_orders where organization_id=c.organization_id and state<>'finished')
   and platform_private.tariff_allows_renewal(o.plan_version_id,statement_timestamp(),true)
   and not exists(select 1 from public.billing_recurring_consents other join public.billing_recurring_methods om on om.consent_id=other.id
    where other.organization_id=c.organization_id and other.id<>c.id and not exists(select 1 from public.billing_recurring_revocations where consent_id=other.id))
  order by s.period_end,c.id limit 10
 loop
  begin
   perform platform_private.prepare_recurring_order(item.id,item.period_end,item.revision);
   prepared:=prepared+1;
  exception when sqlstate '40001' or sqlstate '55000' or sqlstate '22023' then skipped:=skipped+1;
  end;
 end loop;
 return jsonb_build_object('prepared',prepared,'skipped',skipped);
end; $$;
revoke all on function public.prepare_due_sandbox_recurring(text) from public,anon,authenticated;
grant execute on function public.prepare_due_sandbox_recurring(text) to service_role;
commit;
