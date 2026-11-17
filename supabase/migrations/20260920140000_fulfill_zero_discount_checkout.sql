begin;
alter table public.billing_discount_checkout_states drop constraint billing_discount_checkout_states_state_check;
alter table public.billing_discount_checkout_states add constraint billing_discount_checkout_states_state_check check(state in ('ready','executing','cancelled','completed'));
create table public.billing_discount_fulfillments (
 order_id uuid primary key references public.billing_discount_checkouts(id),
 result jsonb not null, fulfilled_at timestamptz not null default clock_timestamp()
);
alter table public.billing_discount_fulfillments enable row level security;
revoke all on public.billing_discount_fulfillments from public,anon,authenticated,service_role;
create trigger discount_fulfillment_immutable before update or delete or truncate on public.billing_discount_fulfillments
 for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.fulfill_zero_discount_checkout(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkout public.billing_discount_checkouts%rowtype; offer public.billing_sandbox_offers%rowtype;
 subscription public.organization_subscriptions%rowtype; result jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_order_id is null then raise exception 'invalid discount checkout' using errcode='22023'; end if;
 -- Такой же порядок, как у существующего подтверждения периода.
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into checkout from public.billing_discount_checkouts where id=p_order_id;
 if not found then raise exception 'discount checkout unavailable' using errcode='22023'; end if;
 select * into subscription from public.organization_subscriptions where organization_id=checkout.organization_id for update;
 select f.result into result from public.billing_discount_fulfillments f where order_id=p_order_id;
 if found then return result; end if;
 if (checkout.quote->>'amount_minor')::bigint is distinct from 0
 or (checkout.quote->>'requires_payment')::boolean is distinct from false then
 raise exception 'discount checkout requires verified payment' using errcode='55000'; end if;
 select * into offer from public.billing_sandbox_offers where id=checkout.offer_id;
 if offer.valid_until<=clock_timestamp() then raise exception 'sandbox offer expired' using errcode='22023'; end if;
 -- До отдельной реализации не сокращать trial и не обходить будущую границу периода.
 if subscription.trial_access_id is not null or subscription.status='trial' then
 raise exception 'trial purchase requires scheduled fulfillment' using errcode='55000'; end if;
 perform platform_private.begin_discount_checkout_execution(p_order_id);
 result:=public.confirm_organization_subscription_period(checkout.organization_id,p_order_id,offer.expected_revision,
 offer.plan_version_id,offer.period_start,offer.period_end);
 perform platform_private.settle_discount_period(p_order_id,true);
 result:=result||jsonb_build_object('order_id',p_order_id,'status','completed','amount_minor',0,'payment_required',false);
 insert into public.billing_discount_fulfillments(order_id,result) values(p_order_id,result);
 update public.billing_discount_checkout_states set state='completed',changed_at=clock_timestamp() where order_id=p_order_id;
 return result;
end; $$;
revoke all on function platform_private.fulfill_zero_discount_checkout(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('platform_private.accept_discount_checkout(uuid,uuid,uuid,text)'::regprocedure);
 if position('when ''executing'' then ''executing''' in definition)=0 then raise exception 'checkout completed patch mismatch'; end if;
 definition:=replace(definition,'when ''executing'' then ''executing''','when ''completed'' then ''completed'' when ''executing'' then ''executing''');
 execute definition;
end; $$;
commit;
