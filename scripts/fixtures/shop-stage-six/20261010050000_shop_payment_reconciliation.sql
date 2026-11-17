-- Durable shop-only GET reconciliation queue. No provider calls or scheduler
-- activation. Five-minute leases/retries are technical defaults, not payment SLA.
begin;
create table public.shop_payment_reconciliation_jobs (
 attempt_id uuid primary key references public.shop_payment_attempts(id),
 state text not null default 'ready' check(state in ('ready','needs_attention','complete')),
 next_check_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 attempts bigint not null default 0 check(attempts>=0),
 last_error text check(last_error in ('missing_payment_id','provider_unavailable','verification_failed','storage_failure')),
 check((lease_token is null)=(lease_until is null)),
 check(state='ready' or lease_token is null)
);
create index shop_payment_reconciliation_due on public.shop_payment_reconciliation_jobs(next_check_at,attempt_id) where state='ready';
alter table public.shop_payment_reconciliation_jobs enable row level security;
revoke all on public.shop_payment_reconciliation_jobs from public,anon,authenticated,service_role;

create function platform_private.queue_shop_payment_reconciliation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into public.shop_payment_reconciliation_jobs(attempt_id) values(new.id) on conflict(attempt_id) do nothing;
 elsif old.provider_payment_id is null and new.provider_payment_id is not null then
  -- An unknown POST without an ID cannot be polled. A later validated binding
  -- wakes that durable attention item; it never allocates a new payment.
  update public.shop_payment_reconciliation_jobs set state='ready',next_check_at=clock_timestamp(),last_error=null
   where attempt_id=new.id and state<>'complete';
 end if;
 return new;
end;$$;
create trigger shop_payment_reconciliation_enqueue after insert or update of provider_payment_id on public.shop_payment_attempts
 for each row execute function platform_private.queue_shop_payment_reconciliation();
insert into public.shop_payment_reconciliation_jobs(attempt_id,state)
 select a.id,case when o.fulfillment_state='complete' then 'complete' else 'ready' end
 from public.shop_payment_attempts a join public.shop_orders o on o.id=a.order_id
 on conflict(attempt_id) do nothing;

create function public.claim_shop_payment_reconciliation(p_merchant text,p_environment text,p_test_only boolean,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; token uuid; result jsonb:='[]'::jsonb;
begin
 if p_merchant is null or p_merchant !~ '^[0-9]+$' or p_environment is null
  or p_environment not in ('sandbox','production') or p_test_only is null
  or p_limit is null or p_limit not between 1 and 5 then
  raise exception 'invalid shop reconciliation scope' using errcode='22023';
 end if;
 for candidate in
  select j.attempt_id,a.order_id,a.provider_payment_id,o.fulfillment_state
  from public.shop_payment_reconciliation_jobs j
  join public.shop_payment_attempts a on a.id=j.attempt_id
  join public.shop_payment_contracts c on c.order_id=a.order_id
  join public.shop_orders o on o.id=a.order_id
  where j.state='ready' and j.next_check_at<=clock_timestamp()
   and (j.lease_until is null or j.lease_until<=clock_timestamp())
   and (a.lease_until is null or a.lease_until<=clock_timestamp())
   and a.provider='yookassa' and a.merchant=p_merchant and a.environment=p_environment
   and c.provider=a.provider and c.merchant=a.merchant and c.environment=a.environment and c.test_only=p_test_only
  order by j.next_check_at,j.attempt_id limit p_limit for update of j skip locked
 loop
  if candidate.fulfillment_state='complete' then
   update public.shop_payment_reconciliation_jobs set state='complete',lease_token=null,lease_until=null,last_error=null
    where attempt_id=candidate.attempt_id;
  else
   token:=gen_random_uuid();
   update public.shop_payment_reconciliation_jobs set lease_token=token,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1
    where attempt_id=candidate.attempt_id;
   result:=result||jsonb_build_array(jsonb_build_object('orderId',candidate.order_id,'attemptId',candidate.attempt_id,
    'leaseToken',token,'paymentId',candidate.provider_payment_id));
  end if;
 end loop;
 return result;
end;$$;

create function public.finish_shop_payment_reconciliation(p_attempt_id uuid,p_lease_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.shop_payment_reconciliation_jobs%rowtype; payment_id text; fulfillment text;
begin
 if p_error is not null and p_error not in ('missing_payment_id','provider_unavailable','verification_failed','storage_failure') then
  raise exception 'invalid shop reconciliation error' using errcode='22023'; end if;
 select * into job from public.shop_payment_reconciliation_jobs where attempt_id=p_attempt_id for update;
 if not found or job.state<>'ready' or p_lease_token is null or job.lease_token is distinct from p_lease_token
  or job.lease_until is null or job.lease_until<=clock_timestamp() then return false; end if;
 select a.provider_payment_id,o.fulfillment_state into strict payment_id,fulfillment
  from public.shop_payment_attempts a join public.shop_orders o on o.id=a.order_id where a.id=p_attempt_id;
 update public.shop_payment_reconciliation_jobs
  set state=case when fulfillment='complete' then 'complete' when payment_id is null then 'needs_attention' else 'ready' end,
   next_check_at=clock_timestamp()+interval '5 minutes',lease_token=null,lease_until=null,
   last_error=case when fulfillment='complete' then null when payment_id is null then 'missing_payment_id'
    when p_error='missing_payment_id' then null else p_error end
  where attempt_id=p_attempt_id;
 return true;
end;$$;

create function public.list_shop_payment_attention(p_merchant text,p_environment text,p_test_only boolean,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_merchant is null or p_merchant !~ '^[0-9]+$' or p_environment is null
  or p_environment not in ('sandbox','production') or p_test_only is null
  or p_limit is null or p_limit not between 1 and 100 then
  raise exception 'invalid shop reconciliation scope' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('orderId',q.order_id,'attemptId',q.attempt_id,'reason',q.last_error)),'[]'::jsonb) into result
 from (select a.order_id,j.attempt_id,j.last_error from public.shop_payment_reconciliation_jobs j
  join public.shop_payment_attempts a on a.id=j.attempt_id
  join public.shop_payment_contracts c on c.order_id=a.order_id
  where j.state='needs_attention' and a.provider='yookassa' and a.merchant=p_merchant and a.environment=p_environment
   and c.provider=a.provider and c.merchant=a.merchant and c.environment=a.environment and c.test_only=p_test_only
  order by j.next_check_at,j.attempt_id limit p_limit) q;
 return result;
end;$$;

revoke all on function platform_private.queue_shop_payment_reconciliation() from public,anon,authenticated,service_role;
revoke all on function public.claim_shop_payment_reconciliation(text,text,boolean,integer),
 public.finish_shop_payment_reconciliation(uuid,uuid,text),public.list_shop_payment_attention(text,text,boolean,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.claim_shop_payment_reconciliation(text,text,boolean,integer),
 public.finish_shop_payment_reconciliation(uuid,uuid,text),public.list_shop_payment_attention(text,text,boolean,integer) to service_role;
commit;
