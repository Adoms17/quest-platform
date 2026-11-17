begin;
create table public.billing_sandbox_settlement_schedule (
 order_id uuid primary key references public.billing_sandbox_orders(id),
 amount_minor bigint not null check(amount_minor>0),
 period_end timestamptz not null check(isfinite(period_end)),
 enabled boolean not null default false,
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>period_end and expires_at<=period_end+interval '24 hours'),
 next_check_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0 check(attempts between 0 and 6),
 last_request_id bigint,
 stop_reason text check(stop_reason in ('succeeded','review','expired','attempt_limit','ineligible'))
);
alter table public.billing_sandbox_settlement_schedule enable row level security;
revoke all on public.billing_sandbox_settlement_schedule from public,anon,authenticated,service_role;

create function platform_private.settlement_schedule_eligible(p_order_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.billing_sandbox_settlement_schedule q
 join public.billing_sandbox_orders o on o.id=q.order_id
 join public.billing_subscription_fiscal_terms t on t.order_id=o.id
 join public.billing_fiscal_policy_models m on m.policy_id=t.policy_id
 join public.billing_sandbox_payment_results p on p.order_id=o.id
 join public.billing_receipt_payment_status r on r.order_id=o.id
 where q.order_id=p_order_id and q.enabled and q.expires_at>clock_timestamp()
 and q.period_end<=clock_timestamp() and o.shop_id='1467641' and o.currency='RUB'
 and o.amount_minor=q.amount_minor and o.period_end=q.period_end
 and t.period_start=o.period_start and t.period_end=o.period_end
 and m.model_version='subscription_access_v1' and m.settlement_basis='period_end'
 and p.shop_id=o.shop_id and p.status='succeeded' and p.paid and not p.requires_review
 and r.status='succeeded' and r.payment_id=p.payment_id
 and exists(select 1 from public.billing_sandbox_application_scope a where a.organization_id=o.organization_id)
 and not exists(select 1 from public.billing_sandbox_refunds f where f.order_id=o.id and f.state not in ('canceled','rejected'))
 and not exists(select 1 from public.billing_prepayment_settlement_status s where s.order_id=o.id and (s.requires_review or s.status='canceled')));
$$;
revoke all on function platform_private.settlement_schedule_eligible(uuid) from public,anon,authenticated,service_role;

create function public.claim_scheduled_subscription_settlement(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- Serialize permission checks with both operator revocation and the normal claim.
 perform 1 from public.billing_sandbox_settlement_schedule where order_id=p_order_id for update;
 perform 1 from public.billing_sandbox_orders where id=p_order_id for update;
 if not platform_private.settlement_schedule_eligible(p_order_id) then
  raise exception 'scheduled settlement denied' using errcode='55000';
 end if;
 return public.claim_prepayment_settlement(p_order_id);
end; $$;
revoke all on function public.claim_scheduled_subscription_settlement(uuid) from public,anon,authenticated;
grant execute on function public.claim_scheduled_subscription_settlement(uuid) to service_role;

create function platform_private.run_scheduled_subscription_settlements() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; token text; signed_at text; signature text; request_id bigint; sent integer:=0; reason text;
begin
 if not pg_try_advisory_xact_lock(30092026,3) then return jsonb_build_object('busy',true); end if;
 for item in select q.*,s.status,s.requires_review from public.billing_sandbox_settlement_schedule q
 left join public.billing_prepayment_settlement_status s on s.order_id=q.order_id
 where q.enabled order by q.next_check_at,q.order_id limit 5 for update of q skip locked
 loop
  reason:=case when item.requires_review or item.status='canceled' then 'review'
   when item.status='succeeded' then 'succeeded'
   when clock_timestamp()>=item.expires_at then 'expired'
   when item.attempts>=6 then 'attempt_limit' else null end;
  if reason is null and clock_timestamp()<greatest(item.period_end,item.next_check_at) then continue; end if;
  if reason is null and not platform_private.settlement_schedule_eligible(item.order_id) then reason:='ineligible'; end if;
  if reason is not null then
   update public.billing_sandbox_settlement_schedule set enabled=false,stop_reason=reason where order_id=item.order_id;
   continue;
  end if;
  if token is null then
   select decrypted_secret into token from vault.decrypted_secrets where name='qvesta_stage_reconcile_worker_token';
   if token is null or token !~ '^[a-f0-9]{64}$' then raise exception 'scheduler token unavailable'; end if;
  end if;
  signed_at:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature:=encode(extensions.hmac('qvesta-order-settlement-v1'||chr(10)||item.order_id::text||chr(10)||signed_at,token,'sha256'),'hex');
  select net.http_post(url:='https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-subscription-settlement-order',
   headers:=jsonb_build_object('Content-Type','application/json','x-qvesta-order-id',item.order_id::text,
    'x-qvesta-order-timestamp',signed_at,'x-qvesta-order-signature',signature),body:='{}'::jsonb,timeout_milliseconds:=45000) into request_id;
  update public.billing_sandbox_settlement_schedule set attempts=attempts+1,last_request_id=request_id,
   next_check_at=clock_timestamp()+interval '5 minutes' where order_id=item.order_id;
  sent:=sent+1;
 end loop;
 return jsonb_build_object('busy',false,'sent',sent);
end; $$;
revoke all on function platform_private.run_scheduled_subscription_settlements() from public,anon,authenticated,service_role;
select cron.schedule('quest-stage-subscription-settlement','* * * * *',
 $job$set statement_timeout='45s'; set lock_timeout='5s'; select platform_private.run_scheduled_subscription_settlements();$job$);
select cron.alter_job((select jobid from cron.job where jobname='quest-stage-subscription-settlement'),active:=false);
commit;
