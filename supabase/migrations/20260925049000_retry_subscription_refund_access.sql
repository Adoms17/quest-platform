begin;
create function public.list_sandbox_subscription_refund_applications(p_shop_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(q.id),'[]'::jsonb) from (
 select f.id from public.billing_sandbox_refunds f
 join public.billing_sandbox_orders o on o.id=f.order_id
 join public.subscription_refund_reservations l on l.refund_id=f.id
 where o.shop_id=p_shop_id and f.state='succeeded' and f.first_sent_at is not null
 and f.provider_refund_id is not null
 and not exists(select 1 from public.subscription_refund_applications a where a.request_id=l.request_id)
 order by f.updated_at,f.id limit 5) q;
$$;
create function public.retry_sandbox_subscription_refund_application(p_shop_id text,p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; f public.billing_sandbox_refunds%rowtype; result jsonb;
begin
 select o.organization_id into org from public.billing_sandbox_orders o
 join public.billing_sandbox_refunds x on x.order_id=o.id
 join public.subscription_refund_reservations l on l.refund_id=x.id
 where x.id=p_refund_id and o.shop_id=p_shop_id;
 if not found then raise exception 'subscription refund scope denied' using errcode='42501'; end if;
 perform 1 from public.organization_subscriptions where organization_id=org for update;
 perform 1 from public.billing_sandbox_orders o join public.billing_sandbox_refunds x on x.order_id=o.id where x.id=p_refund_id for update of o;
 select * into f from public.billing_sandbox_refunds where id=p_refund_id for update;
 if f.state<>'succeeded' or f.provider_refund_id is null or f.first_sent_at is null then
  return jsonb_build_object('access_state','not_applied'); end if;
 result:=platform_private.reconcile_subscription_refund(f.id,f.provider_refund_id,'succeeded');
 -- Rotate domain failures so a reviewed case cannot starve the limited batch.
 update public.billing_sandbox_refunds set updated_at=clock_timestamp() where id=f.id;
 return result;
end; $$;
revoke all on function public.list_sandbox_subscription_refund_applications(text),public.retry_sandbox_subscription_refund_application(text,uuid) from public,anon,authenticated;
grant execute on function public.list_sandbox_subscription_refund_applications(text),public.retry_sandbox_subscription_refund_application(text,uuid) to service_role;
commit;
