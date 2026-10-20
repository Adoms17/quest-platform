begin;
-- Bind the first verified provider identity only to an authorized send.
do $$
declare definition text; marker text:='if exists(select 1 from public.subscription_refund_reservations where refund_id=old.id) then';
begin
 definition:=pg_get_functiondef('platform_private.block_unintegrated_subscription_refund()'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund result gate marker missing'; end if;
 execute replace(definition,marker,marker||'
 if old.state=''sending'' and old.first_sent_at is not null and old.provider_refund_id is null
 and new.state=''pending'' and new.provider_refund_id is not null
 and (to_jsonb(new)-''state''-''updated_at''-''provider_refund_id'')=(to_jsonb(old)-''state''-''updated_at''-''provider_refund_id'')
 and exists(select 1 from public.subscription_refund_dispatches d where d.refund_id=old.id and d.authorized_at=old.first_sent_at) then return new; end if;');
end; $$;
-- Inputs must come from an authenticated provider API response, never raw webhook data.
create function platform_private.record_subscription_refund_result(p_refund_id uuid,p_shop_id text,p_payment_id uuid,
 p_provider_id uuid,p_status text,p_amount_minor bigint,p_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; order_row public.billing_sandbox_orders%rowtype; refund public.billing_sandbox_refunds%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 select r.organization_id into org from public.subscription_refund_requests r
 join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id=p_refund_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 perform 1 from public.organization_subscriptions where organization_id=org for update;
 select o.* into order_row from public.billing_sandbox_orders o join public.billing_sandbox_refunds f on f.order_id=o.id where f.id=p_refund_id for update of o;
 select * into refund from public.billing_sandbox_refunds where id=p_refund_id for update;
 if p_provider_id is null or p_status is null or p_status not in ('pending','succeeded','canceled')
 or p_shop_id is distinct from order_row.shop_id or p_payment_id is distinct from refund.payment_id
 or p_amount_minor is distinct from refund.amount_minor or p_currency is distinct from order_row.currency
 or refund.first_sent_at is null
 or not exists(select 1 from public.subscription_refund_dispatches d where d.refund_id=refund.id and d.authorized_at=refund.first_sent_at) then
 raise exception 'invalid subscription refund result' using errcode='22023'; end if;
 if refund.provider_refund_id is null then
  if refund.state<>'sending' then raise exception 'invalid subscription refund result' using errcode='22023'; end if;
  update public.billing_sandbox_refunds set provider_refund_id=p_provider_id,state='pending',updated_at=clock_timestamp() where id=refund.id;
 elsif refund.provider_refund_id<>p_provider_id then
  raise exception 'refund identity conflict' using errcode='22023';
 end if;
 return platform_private.reconcile_subscription_refund(refund.id,p_provider_id,p_status);
end; $$;
revoke all on function platform_private.record_subscription_refund_result(uuid,text,uuid,uuid,text,bigint,text) from public,anon,authenticated,service_role;
commit;
