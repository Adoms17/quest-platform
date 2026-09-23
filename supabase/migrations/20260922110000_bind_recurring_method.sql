begin;
-- Вызывается только из server-only apply после проверки платежа и применения/планирования доступа.
create function platform_private.bind_sandbox_recurring_method(p_order_id uuid,p_payment jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare c public.billing_recurring_consents%rowtype; o public.billing_sandbox_orders%rowtype; m public.billing_recurring_methods%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into o from public.billing_sandbox_orders where id=p_order_id;
 if not found then return; end if;
 perform 1 from public.organization_subscriptions where organization_id=o.organization_id for update;
 select * into c from public.billing_recurring_consents where order_id=o.id and organization_id=o.organization_id;
 if not found or o.first_sent_at is null or c.created_at>o.first_sent_at
 or exists(select 1 from public.billing_recurring_revocations where consent_id=c.id)
 or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id)
 then return; end if;
 if p_payment->>'status' is distinct from 'succeeded' or p_payment->'paid' is distinct from 'true'::jsonb
 or p_payment->'test' is distinct from 'true'::jsonb or jsonb_typeof(p_payment->'savedMethodId') is distinct from 'string'
 or length(p_payment->>'savedMethodId') not between 1 and 256 or not (p_payment->>'savedMethodId' ~ '^[A-Za-z0-9_-]+$') then return; end if;
 if not exists(select 1 from public.billing_sandbox_payment_results where order_id=o.id and shop_id=o.shop_id
 and payment_id=(p_payment->>'paymentId')::uuid and status='succeeded' and paid and not requires_review)
 or not exists(select 1 from public.billing_sandbox_fulfillments where order_id=o.id and state in ('applied','deferred'))
 then return; end if;
 select * into m from public.billing_recurring_methods where consent_id=c.id;
 if found then
  if m.provider_method_id is distinct from p_payment->>'savedMethodId' or m.verified_payment_id is distinct from (p_payment->>'paymentId')::uuid then
   raise exception 'recurring method conflict' using errcode='22023';
  end if;
  return;
 end if;
 insert into public.billing_recurring_methods(consent_id,provider_method_id,verified_payment_id)
 values(c.id,p_payment->>'savedMethodId',(p_payment->>'paymentId')::uuid);
end; $$;
revoke all on function platform_private.bind_sandbox_recurring_method(uuid,jsonb) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='update public.billing_sandbox_events set processed_at=clock_timestamp()';
begin
 definition:=pg_get_functiondef('public.apply_sandbox_payment_event(uuid,jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'recurring event marker missing'; end if;
 execute replace(definition,marker,'perform platform_private.bind_sandbox_recurring_method(o.id,p_payment); '||marker);
end; $$;
commit;
