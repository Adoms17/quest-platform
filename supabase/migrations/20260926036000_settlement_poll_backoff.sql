begin;
alter table public.billing_prepayment_settlement_status
 add column poll_failures integer not null default 0 check(poll_failures between 0 and 16),
 add column last_polled_at timestamptz,
 add column next_check_at timestamptz not null default '-infinity';
create function public.record_settlement_poll(p_order_id uuid,p_resolved boolean) returns void
language plpgsql security definer set search_path='' as $$
declare failures integer;
begin
 if p_resolved is null then raise exception 'invalid settlement poll' using errcode='22023'; end if;
 select case when p_resolved then 0 else least(poll_failures+1,16) end into failures
 from public.billing_prepayment_settlement_status where order_id=p_order_id for update;
 if not found then raise exception 'settlement unavailable' using errcode='22023'; end if;
 update public.billing_prepayment_settlement_status set poll_failures=failures,
  last_polled_at=clock_timestamp(),next_check_at=clock_timestamp()+make_interval(secs=>
   case when p_resolved then 300 else least(3600,60*power(2,failures-1))::integer end)
 where order_id=p_order_id;
end; $$;
revoke all on function public.record_settlement_poll(uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_settlement_poll(uuid,boolean) to service_role;
create or replace function public.list_pending_prepayment_settlements(p_shop_id text,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or p_limit is null or p_limit<1 or p_limit>100 then
  raise exception 'invalid settlement batch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
  select jsonb_build_object('orderId',s.order_id,'shopId',o.shop_id,'body',r.body,'receiptId',s.provider_receipt_id) item
  from public.billing_prepayment_settlement_status s
  join public.billing_prepayment_settlements r on r.order_id=s.order_id
  join public.billing_sandbox_orders o on o.id=s.order_id
  where o.shop_id=p_shop_id and not s.requires_review and s.status in ('unknown','pending')
   and s.next_check_at<=statement_timestamp()
  order by coalesce(s.last_polled_at,s.first_sent_at),s.order_id limit p_limit
 ) batch;
 return result;
end; $$;
commit;
