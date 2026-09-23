begin;
create function public.read_recurring_failure_notice(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare notice jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.read') then
  raise exception 'billing access denied' using errcode='42501';
 end if;
 select jsonb_build_object('status','payment_failed','period_start',r.period_start,'failed_at',c.created_at)
 into notice
 from public.billing_recurring_orders r
 join public.billing_recurring_cancellations c on c.order_id=r.id and c.reason='provider_canceled'
 join public.billing_recurring_results p on p.order_id=r.id and p.status='canceled' and not p.paid and not p.requires_review
 join public.organization_subscriptions s on s.organization_id=r.organization_id
 where r.organization_id=p_organization_id
  and s.plan_version_id=r.plan_version_id and s.period_end=r.period_start
  and platform_private.recurring_source_revision(s)=r.expected_revision
  and not exists(select 1 from public.billing_period_confirmations where confirmation_id=r.id)
 order by r.period_start desc,r.id limit 1;
 return notice;
end; $$;
revoke all on function public.read_recurring_failure_notice(uuid) from public,anon,service_role;
grant execute on function public.read_recurring_failure_notice(uuid) to authenticated;
commit;
