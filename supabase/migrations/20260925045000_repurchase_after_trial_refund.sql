begin;
-- History may contain several purchases, but exactly one live slot per trial.
create table platform_private.trial_paid_period_slots (
 access_id uuid primary key references public.billing_trial_access(id),
 order_id uuid not null unique references public.billing_trial_paid_periods(order_id)
);
alter table platform_private.trial_paid_period_slots enable row level security;
revoke all on platform_private.trial_paid_period_slots from public,anon,authenticated,service_role;
insert into platform_private.trial_paid_period_slots(access_id,order_id)
 select access_id,order_id from platform_private.active_trial_paid_periods;
alter table public.billing_trial_paid_periods drop constraint billing_trial_paid_periods_access_id_key;
create function platform_private.claim_trial_paid_period_slot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into platform_private.trial_paid_period_slots(access_id,order_id) values(new.access_id,new.order_id);
 return new;
end; $$;
create trigger claim_trial_paid_period_slot after insert on public.billing_trial_paid_periods
 for each row execute function platform_private.claim_trial_paid_period_slot();
create function platform_private.release_refunded_trial_slot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from platform_private.trial_paid_period_slots where order_id=new.period_order_id;
 return new;
end; $$;
create trigger release_refunded_trial_slot after insert on public.subscription_refund_applications
 for each row execute function platform_private.release_refunded_trial_slot();
revoke all on function platform_private.claim_trial_paid_period_slot(),platform_private.release_refunded_trial_slot() from public,anon,authenticated,service_role;
do $$
declare signature text; definition text; marker text:='from public.billing_trial_paid_periods';
begin
 foreach signature in array array[
 'platform_private.capture_trial_checkout_terms(uuid,uuid)',
 'public.begin_sandbox_payment_send(uuid)',
 'platform_private.resolve_refunded_trial_duplicate(uuid)',
 'platform_private.apply_current_subscription_refund(uuid)'
 ] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position(marker in definition)=0 then raise exception 'trial repurchase marker missing: %',signature; end if;
 execute replace(definition,marker,'from platform_private.active_trial_paid_periods');
 end loop;
end; $$;
commit;
