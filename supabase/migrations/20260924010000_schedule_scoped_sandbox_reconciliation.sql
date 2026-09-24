begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;
-- pg_net stores authentication headers in its internal queue; never expose them through API roles.
revoke all on net.http_request_queue from public,anon,authenticated,service_role;

-- Explicit stage acceptance allowlist. Neither payments nor recurring orders are created here.
create table public.billing_sandbox_scheduled_orders (
 order_id uuid primary key references public.billing_sandbox_orders(id) on delete restrict,
 enabled boolean not null default false,
 not_before timestamptz not null check(isfinite(not_before)),
 expires_at timestamptz not null check(isfinite(expires_at)),
 next_check_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0 check(attempts between 0 and 6),
 last_request_id bigint,
 stop_reason text check(stop_reason in ('applied','review','expired','attempt_limit','ineligible')),
 check(expires_at>not_before and expires_at<=not_before+interval '24 hours')
);
alter table public.billing_sandbox_scheduled_orders enable row level security;
revoke all on public.billing_sandbox_scheduled_orders from public,anon,authenticated,service_role;

create function platform_private.run_scheduled_sandbox_orders()
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; token text; request_id bigint; sent integer:=0; stopped integer:=0;
begin
 if not pg_try_advisory_xact_lock(24092026,7) then return jsonb_build_object('busy',true); end if;
 for item in
  select q.*,o.period_start,o.state as order_state,p.status as payment_status,p.paid,p.requires_review,
   f.state as fulfillment_state,
   exists(select 1 from public.billing_sandbox_application_scope a where a.organization_id=o.organization_id) as in_scope
  from public.billing_sandbox_scheduled_orders q
  join public.billing_sandbox_orders o on o.id=q.order_id
  left join public.billing_sandbox_payment_results p on p.order_id=o.id
  left join public.billing_sandbox_fulfillments f on f.order_id=o.id
  where q.enabled order by greatest(q.next_check_at,q.not_before,o.period_start),q.order_id limit 5 for update of q skip locked
 loop
  if item.fulfillment_state='applied' or item.fulfillment_state='review'
     or clock_timestamp()>=item.expires_at or item.attempts>=6
     or not item.in_scope or item.payment_status is distinct from 'succeeded'
     or item.paid is distinct from true or item.requires_review is distinct from false then
   update public.billing_sandbox_scheduled_orders set enabled=false,stop_reason=case
    when item.fulfillment_state='applied' then 'applied'
    when item.fulfillment_state='review' then 'review'
    when clock_timestamp()>=item.expires_at then 'expired'
    when item.attempts>=6 then 'attempt_limit' else 'ineligible' end where order_id=item.order_id;
   stopped:=stopped+1;
   continue;
  end if;
  if clock_timestamp()<greatest(item.not_before,item.period_start,item.next_check_at) then continue; end if;
  if token is null then
   select decrypted_secret into token from vault.decrypted_secrets where name='qvesta_stage_reconcile_worker_token';
   if token is null or token !~ '^[a-f0-9]{64}$' then raise exception 'scheduler token unavailable' using errcode='55000'; end if;
  end if;
  select net.http_post(
   url:='https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-reconcile-order',
   headers:=jsonb_build_object('Content-Type','application/json','x-qvesta-worker-token',token,'x-qvesta-order-id',item.order_id::text),
   body:='{}'::jsonb,timeout_milliseconds:=45000) into request_id;
  update public.billing_sandbox_scheduled_orders set attempts=attempts+1,last_request_id=request_id,
   next_check_at=clock_timestamp()+interval '5 minutes' where order_id=item.order_id;
  sent:=sent+1;
 end loop;
 return jsonb_build_object('busy',false,'sent',sent,'stopped',stopped);
end; $$;
revoke all on function platform_private.run_scheduled_sandbox_orders() from public,anon,authenticated,service_role;
-- No token and no orders are provisioned by this migration. Rollout enables the dedicated job separately.
select cron.schedule('quest-stage-order-reconciliation','* * * * *',
 $job$set statement_timeout='45s'; set lock_timeout='5s'; select platform_private.run_scheduled_sandbox_orders();$job$);
select cron.alter_job((select jobid from cron.job where jobname='quest-stage-order-reconciliation'),active:=false);
commit;