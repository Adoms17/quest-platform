begin;
-- Только уже подготовленные заказы. Создание новых периодов не выполняется.
create function public.list_sandbox_recurring_work(p_shop_id text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(q.id order by q.checked_at nulls first,q.created_at,q.id),'[]'::jsonb)
 from (
  select r.id,p.checked_at,r.created_at
  from public.billing_recurring_orders r
  join public.billing_sandbox_orders source on source.id=r.source_order_id
  left join public.billing_recurring_attempts a on a.order_id=r.id
  left join public.billing_recurring_results p on p.order_id=r.id
  where source.shop_id=p_shop_id
   and (a.order_id is not null or r.period_start<=now())
   and not exists(select 1 from public.billing_recurring_cancellations c where c.order_id=r.id)
   and (p.order_id is null or (not p.requires_review and p.status in ('pending','waiting_for_capture')))
   and (a.order_id is not null or exists(select 1 from public.billing_discount_reservations d where d.order_id=r.id and d.state='reserved'))
  order by p.checked_at nulls first,r.created_at,r.id limit 10
 ) q;
$$;
revoke all on function public.list_sandbox_recurring_work(text) from public,anon,authenticated;
grant execute on function public.list_sandbox_recurring_work(text) to service_role;
commit;
