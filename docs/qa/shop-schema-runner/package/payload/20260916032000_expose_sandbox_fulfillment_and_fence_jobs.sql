begin;
alter table public.billing_sandbox_reconciliation_jobs add column lease_token uuid;
create or replace function public.claim_sandbox_reconciliation(p_shop_id text,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>10 then raise exception 'invalid sandbox batch' using errcode='22023'; end if;
 insert into public.billing_sandbox_reconciliation_jobs(order_id)
 select id from public.billing_sandbox_orders where shop_id=p_shop_id and first_sent_at is not null and state<>'finished'
 on conflict(order_id) do nothing;
 with candidates as (
  select j.order_id from public.billing_sandbox_reconciliation_jobs j join public.billing_sandbox_orders o on o.id=j.order_id
  where o.shop_id=p_shop_id and j.next_check_at<=clock_timestamp() and (j.lease_until is null or j.lease_until<=clock_timestamp())
  and (o.state<>'finished' or exists(select 1 from public.billing_sandbox_events e where e.order_id=o.id and e.processed_at is null))
  order by j.next_check_at,j.order_id limit p_limit for update of j skip locked
 ), claimed as (
  update public.billing_sandbox_reconciliation_jobs j set lease_until=clock_timestamp()+interval '5 minutes',lease_token=gen_random_uuid(),attempts=attempts+1
  from candidates c where c.order_id=j.order_id returning j.order_id,j.lease_token
 ) select coalesce(jsonb_agg(jsonb_build_object('orderId',order_id,'leaseToken',lease_token)),'[]'::jsonb) into result from claimed;
 return result;
end;$$;
drop function public.finish_sandbox_reconciliation(uuid,text);
create function public.finish_sandbox_reconciliation(p_order_id uuid,p_lease_token uuid,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_error is not null and p_error not in ('provider_unavailable','payment_not_found','verification_failed') then raise exception 'invalid sandbox outcome' using errcode='22023'; end if;
 update public.billing_sandbox_reconciliation_jobs set lease_until=null,lease_token=null,next_check_at=clock_timestamp()+interval '5 minutes',last_error=p_error
 where order_id=p_order_id and lease_token=p_lease_token;
end;$$;
revoke all on function public.finish_sandbox_reconciliation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_sandbox_reconciliation(uuid,uuid,text) to service_role;

alter function public.get_sandbox_order_offer(uuid,uuid) rename to get_sandbox_order_offer_before_fulfillment;
revoke all on function public.get_sandbox_order_offer_before_fulfillment(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_sandbox_order_offer(p_organization_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; f public.billing_sandbox_fulfillments%rowtype;
begin
 result:=public.get_sandbox_order_offer_before_fulfillment(p_organization_id,p_order_id);
 select * into f from public.billing_sandbox_fulfillments where order_id=p_order_id;
 return result||jsonb_build_object('fulfillment_state',coalesce(f.state,'none'));
end;$$;
revoke all on function public.get_sandbox_order_offer(uuid,uuid) from public,anon;
grant execute on function public.get_sandbox_order_offer(uuid,uuid) to authenticated;
commit;
