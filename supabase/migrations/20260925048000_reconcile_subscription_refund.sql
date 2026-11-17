begin;
-- Sending remains disabled. Only reconciliation of an already identified send is allowed.
create or replace function platform_private.block_unintegrated_subscription_refund() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.subscription_refund_reservations where refund_id=old.id) then
  if old.first_sent_at is not null and old.provider_refund_id is not null
   and old.state in ('pending','succeeded','canceled','review')
   and new.state in ('pending','succeeded','canceled','review')
   and (old.state='pending' or new.state=old.state or new.state='review')
   and (to_jsonb(new)-'state'-'updated_at')=(to_jsonb(old)-'state'-'updated_at') then return new; end if;
  raise exception 'subscription refund execution not enabled' using errcode='55000';
 end if;
 return new;
end; $$;
create function platform_private.reconcile_subscription_refund(p_refund_id uuid,p_provider_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare refund_request_id uuid; org uuid; result jsonb; application jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then
 raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 select r.id,r.organization_id into refund_request_id,org from public.subscription_refund_requests r
 join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id=p_refund_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 -- Consistent lock order with fulfillment and access application.
 perform 1 from public.organization_subscriptions where organization_id=org for update;
 result:=public.record_verified_sandbox_refund(p_refund_id,p_provider_id,p_status);
 if result->>'state'<>'succeeded' then
  return jsonb_build_object('refund',result,'access_state',case when exists(select 1 from public.subscription_refund_applications a where a.request_id=refund_request_id) then 'applied_review_required' else 'not_applied' end); end if;
 begin
  application:=platform_private.apply_subscription_refund(refund_request_id);
 exception when sqlstate '55000' then
  -- Provider success survives a domain failure; retry never sends money again.
  return jsonb_build_object('refund',result,'access_state','review_required');
 end;
 return jsonb_build_object('refund',result,'access_state','applied','application',application);
end; $$;
revoke all on function platform_private.reconcile_subscription_refund(uuid,uuid,text) from public,anon,authenticated,service_role;
commit;
