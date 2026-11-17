begin;
create table public.billing_recurring_checks (
 order_id uuid primary key references public.billing_recurring_orders(id),
 check_count integer not null default 1 check(check_count>0),
 last_started_at timestamptz not null,
 next_check_at timestamptz not null
);
alter table public.billing_recurring_checks enable row level security;
revoke all on public.billing_recurring_checks from public,anon,authenticated,service_role;
-- Резервируем слот проверки до возврата списка: даже потеря ответа RPC
-- оставляет паузу. Это не разрешение платежа и не подтверждение результата.
create or replace function public.list_sandbox_recurring_work(p_shop_id text)
returns jsonb language sql volatile security definer set search_path='' as $$
 with candidates as (
  select r.id,r.created_at,c.next_check_at
  from public.billing_recurring_orders r
  join public.billing_sandbox_orders source on source.id=r.source_order_id
  left join public.billing_recurring_attempts a on a.order_id=r.id
  left join public.billing_recurring_results p on p.order_id=r.id
  left join public.billing_recurring_checks c on c.order_id=r.id
  where source.shop_id=p_shop_id
   and (c.order_id is null or c.next_check_at<=statement_timestamp())
   and (a.order_id is not null or r.period_start<=now())
   and not exists(select 1 from public.billing_recurring_cancellations x where x.order_id=r.id)
   and (p.order_id is null or (not p.requires_review and p.status in ('pending','waiting_for_capture')))
   and (a.order_id is not null or exists(select 1 from public.billing_discount_reservations d where d.order_id=r.id and d.state='reserved'))
  order by c.next_check_at nulls first,r.created_at,r.id limit 10
 ), claimed as (
  insert into public.billing_recurring_checks as checks(order_id,last_started_at,next_check_at)
  select id,statement_timestamp(),statement_timestamp()+interval '5 minutes' from candidates order by id
  on conflict(order_id) do update set
   check_count=least(checks.check_count+1,1000000),
   last_started_at=statement_timestamp(),
   next_check_at=statement_timestamp()+make_interval(mins=>least(60,5*power(2,least(checks.check_count,4))::integer))
  where checks.next_check_at<=statement_timestamp()
  returning order_id
 ) select coalesce(jsonb_agg(order_id order by order_id),'[]'::jsonb) from claimed;
$$;
commit;
