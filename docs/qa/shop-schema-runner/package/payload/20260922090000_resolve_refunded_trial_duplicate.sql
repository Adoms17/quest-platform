begin;
create table public.billing_refunded_duplicate_resolutions (
 order_id uuid primary key references public.billing_sandbox_orders(id),
 original_order_id uuid not null references public.billing_trial_paid_periods(order_id),
 refunded_minor bigint not null check(refunded_minor>0),
 resolved_at timestamptz not null default clock_timestamp(),
 reason text not null default 'fully_refunded_trial_duplicate' check(reason='fully_refunded_trial_duplicate')
);
alter table public.billing_refunded_duplicate_resolutions enable row level security;
revoke all on public.billing_refunded_duplicate_resolutions from public,anon,authenticated,service_role;
create trigger refunded_duplicate_immutable before update or delete or truncate on public.billing_refunded_duplicate_resolutions
for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.resolve_refunded_trial_duplicate(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; c public.billing_discount_checkouts%rowtype;
 original uuid; refunded bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into c from public.billing_discount_checkouts where id=p_order_id;
 if not found then return false; end if;
 perform 1 from public.organization_subscriptions where organization_id=c.organization_id for update;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=c.organization_id for update;
 if not found then return false; end if;
 if exists(select 1 from public.billing_refunded_duplicate_resolutions where order_id=o.id) then return true; end if;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id)
 or not exists(select 1 from public.billing_discount_payment_links where checkout_id=c.id and payment_order_id=o.id)
 or exists(select 1 from public.billing_discount_fulfillments where order_id=o.id)
 or exists(select 1 from public.billing_period_confirmations where confirmation_id=o.id)
 or c.quote#>>'{trial_purchase,transition}' is distinct from 'after_trial'
 or not exists(select 1 from public.billing_sandbox_payment_results p where p.order_id=o.id and p.shop_id=o.shop_id and p.status='succeeded' and p.paid and not p.requires_review)
 then return false; end if;
 select p.order_id into original from public.billing_trial_paid_periods p where p.access_id=(c.quote#>>'{trial_purchase,access_id}')::uuid
 and p.organization_id=o.organization_id and p.order_id<>o.id and p.period_start=o.period_start and p.period_end=o.period_end;
 if original is null then return false; end if;
 if exists(select 1 from public.billing_sandbox_refunds where order_id=o.id and state not in ('succeeded','canceled','rejected')) then return false; end if;
 select coalesce(sum(r.amount_minor),0) into refunded from public.billing_sandbox_refunds r join public.billing_sandbox_payment_results p on p.order_id=r.order_id and p.payment_id=r.payment_id
 where r.order_id=o.id and r.state='succeeded' and r.provider_refund_id is not null;
 if refunded<>o.amount_minor or refunded<=0 then return false; end if;
 perform platform_private.settle_discount_period(c.id,false);
 insert into public.billing_refunded_duplicate_resolutions(order_id,original_order_id,refunded_minor) values(o.id,original,refunded);
 update public.billing_discount_checkout_states set state='cancelled',changed_at=clock_timestamp() where order_id=c.id;
 update public.billing_sandbox_orders set state='finished' where id=o.id;
 return true;
end; $$;
revoke all on function platform_private.resolve_refunded_trial_duplicate(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='perform platform_private.fulfill_discount_payment(p_order_id);';
begin
 definition:=pg_get_functiondef('platform_private.process_discount_payment(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'duplicate resolution marker missing'; end if;
 execute replace(definition,marker,'if platform_private.resolve_refunded_trial_duplicate(p_order_id) then
 return jsonb_build_object(''confirmation_id'',p_order_id,''state'',''not_paid'',''reason'',''fully_refunded_trial_duplicate''); end if; '||marker);
end; $$;
commit;
