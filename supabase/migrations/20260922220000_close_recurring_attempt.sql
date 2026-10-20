begin;
alter table public.billing_recurring_cancellations drop constraint billing_recurring_cancellations_reason_check;
alter table public.billing_recurring_cancellations add constraint billing_recurring_cancellations_reason_check check(reason in ('consent_revoked','sandbox_disabled','method_unavailable','subscription_changed','support_ended','reservation_released','unsent_expired','provider_canceled'));
create function platform_private.close_recurring_attempt(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; p public.billing_recurring_results%rowtype; reason text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 if exists(select 1 from public.billing_recurring_cancellations where order_id=r.id) then return true; end if;
 if exists(select 1 from public.billing_period_confirmations where confirmation_id=r.id)
 or exists(select 1 from public.billing_discount_reservations where order_id=r.id and state='consumed') then return false; end if;
 select * into p from public.billing_recurring_results where order_id=r.id;
 if found then
  if p.status='canceled' and not p.paid and not p.requires_review then reason:='provider_canceled'; else return false; end if;
 elsif not exists(select 1 from public.billing_recurring_dispatches where order_id=r.id)
 and exists(select 1 from public.billing_recurring_attempts where order_id=r.id and created_at<=clock_timestamp()-interval '23 hours') then reason:='unsent_expired';
 else return false;
 end if;
 perform platform_private.settle_discount_period(r.id,false);
 insert into public.billing_recurring_cancellations(order_id,reason) values(r.id,reason);
 return true;
end; $$;
revoke all on function platform_private.close_recurring_attempt(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('platform_private.begin_recurring_attempt(uuid)'::regprocedure);
 marker:='select * into attempt from public.billing_recurring_attempts where order_id=r.id;';
 if position(marker in definition)=0 then raise exception 'begin marker missing'; end if;
 execute replace(definition,marker,'if platform_private.close_recurring_attempt(r.id) then return jsonb_build_object(''state'',''cancelled''); end if; '||marker);
 definition:=pg_get_functiondef('platform_private.record_recurring_result(uuid,jsonb)'::regprocedure);
 marker:='return jsonb_build_object(''paymentId'',old.payment_id';
 if position(marker in definition)=0 then raise exception 'result marker missing'; end if;
 execute replace(definition,marker,'perform platform_private.close_recurring_attempt(r.id); '||marker);
end; $$;
commit;
