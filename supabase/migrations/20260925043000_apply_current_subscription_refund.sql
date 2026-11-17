begin;
create table public.subscription_refund_applications (
 request_id uuid primary key references public.subscription_refund_requests(id),
 refund_id uuid not null unique references public.billing_sandbox_refunds(id),
 period_order_id uuid not null unique,
 before_state jsonb not null, after_state jsonb not null,
 applied_at timestamptz not null default clock_timestamp()
);
alter table public.subscription_refund_applications enable row level security;
revoke all on public.subscription_refund_applications from public,anon,authenticated,service_role;
create trigger subscription_refund_application_immutable before update or delete or truncate
 on public.subscription_refund_applications for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.apply_current_subscription_refund(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; b public.subscription_refund_period_bindings%rowtype;
 f public.billing_sandbox_refunds%rowtype; s public.organization_subscriptions%rowtype;
 a public.subscription_refund_applications%rowtype; previous jsonb; free_id uuid;
begin
 select * into r from public.subscription_refund_requests where id=p_request_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 select * into s from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into a from public.subscription_refund_applications where request_id=r.id;
 if found then return to_jsonb(a); end if;
 perform 1 from public.billing_sandbox_orders where id=r.order_id for update;
 select x.* into f from public.billing_sandbox_refunds x join public.subscription_refund_reservations l on l.refund_id=x.id where l.request_id=r.id for update of x;
 if f.id is null or f.state<>'succeeded' or f.provider_refund_id is null or f.first_sent_at is null
  or f.order_id<>r.order_id or f.amount_minor<>r.amount_minor
  or f.payment_id::text is distinct from r.snapshot->>'payment_id' then
  raise exception 'subscription refund not confirmed' using errcode='55000'; end if;
 select * into b from public.subscription_refund_period_bindings where request_id=r.id;
 -- Complex overlaps and trial periods require their own resolver, not forced Free.
 if b.request_id is null or b.kind<>'confirmed' or s.trial_access_id is not null
  or s.status not in ('active','expired') or s.plan_version_id is distinct from b.plan_version_id
  or s.period_start is distinct from b.period_start or s.period_end is distinct from b.period_end
  or s.scheduled_plan_version_id is not null
  or exists(select 1 from public.billing_trial_paid_periods where organization_id=r.organization_id and period_end>clock_timestamp()) then
  raise exception 'subscription refund access review required' using errcode='55000'; end if;
 free_id:=platform_private.current_tariff_version('free',clock_timestamp());
 if free_id is null then raise exception 'current free tariff unavailable' using errcode='55000'; end if;
 previous:=to_jsonb(s);
 update public.organization_subscriptions set status='free',plan_version_id=free_id,
 period_start=null,period_end=null,cancel_at_period_end=false,scheduled_plan_version_id=null,scheduled_effective_at=null
 where organization_id=r.organization_id returning * into s;
 insert into public.subscription_refund_applications(request_id,refund_id,period_order_id,before_state,after_state)
 values(r.id,f.id,b.period_order_id,previous,to_jsonb(s)) returning * into a;
 return to_jsonb(a);
end; $$;
revoke all on function platform_private.apply_current_subscription_refund(uuid) from public,anon,authenticated,service_role;
-- Old confirmation replay must not report or restore a refunded period.
do $$
declare definition text; marker text:='-- Один серверный идентификатор нельзя применить к двум организациям.';
begin
 definition:=pg_get_functiondef('public.confirm_organization_subscription_period(uuid,uuid,bigint,uuid,timestamptz,timestamptz)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'period confirmation guard marker missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.subscription_refund_applications where period_order_id=p_confirmation_id) then raise exception ''subscription period refunded'' using errcode=''55000''; end if; '||marker);
end; $$;
commit;
