begin;
create function platform_private.apply_recurring_period(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; p public.billing_recurring_results%rowtype; checked jsonb; result jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then raise exception 'recurring order unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 perform pg_advisory_xact_lock(hashtextextended(r.id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into p from public.billing_recurring_results where order_id=r.id;
 if p.requires_review then return jsonb_build_object('state','requires_review'); end if;
 if exists(select 1 from public.billing_period_confirmations where confirmation_id=r.id) then return jsonb_build_object('state','applied'); end if;
 if exists(select 1 from public.billing_recurring_cancellations where order_id=r.id)
 or not exists(select 1 from public.billing_discount_reservations where order_id=r.id and state='reserved') then return jsonb_build_object('state','unavailable'); end if;
 if (r.quote->>'requires_payment')::boolean then
  if p.status is distinct from 'succeeded' or p.paid is distinct from true
  or not exists(select 1 from public.billing_recurring_dispatches where order_id=r.id) then return jsonb_build_object('state','payment_required'); end if;
 else
  if (r.quote->>'amount_minor')::bigint is distinct from 0 or exists(select 1 from public.billing_recurring_attempts where order_id=r.id) then return jsonb_build_object('state','requires_review'); end if;
  checked:=platform_private.review_recurring_order(r.id);
  if checked->>'state'<>'ready' then return checked; end if;
 end if;
 if clock_timestamp()<r.period_start then return jsonb_build_object('state','deferred'); end if;
 if clock_timestamp()>=r.period_end then return jsonb_build_object('state','requires_review'); end if;
 -- Ошибка конфликта ревизии откатывает выдачу и расход скидки вместе.
 result:=public.confirm_organization_subscription_period(r.organization_id,r.id,r.expected_revision,r.plan_version_id,r.period_start,r.period_end);
 perform platform_private.settle_discount_period(r.id,true);
 return jsonb_build_object('state','applied','revision',result->'revision');
end; $$;
revoke all on function platform_private.apply_recurring_period(uuid) from public,anon,authenticated,service_role;
commit;
