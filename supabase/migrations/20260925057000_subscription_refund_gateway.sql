begin;
-- Параметры личности передаёт только доверенный сервер ПОСЛЕ проверки JWT.
create function public.subscription_refund_from_gateway(p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_action text,p_refund_id uuid,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
 or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300
 or p_expires_at is null or p_expires_at<=epoch
 or p_action is null or p_action not in ('read','claim','recover','record')
 or p_refund_id is null then raise exception 'invalid refund gateway context' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id,'role','authenticated','aal','aal2','exp',p_expires_at,
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',p_mfa_at)))::text,true);
 begin
  perform public.require_platform_owner();
  if not exists(select 1 from public.subscription_refund_reservations l
   join public.subscription_refund_requests r on r.id=l.request_id
   join public.billing_sandbox_application_scope s on s.organization_id=r.organization_id
   where l.refund_id=p_refund_id) then raise exception 'subscription refund scope denied' using errcode='42501'; end if;
  if p_action='read' then
   select jsonb_build_object('refund',to_jsonb(f),'order',public.read_sandbox_reconciliation_order(o.shop_id,o.id,f.payment_id)) into result
   from public.billing_sandbox_refunds f join public.billing_sandbox_orders o on o.id=f.order_id where f.id=p_refund_id;
  elsif p_action='claim' then result:=platform_private.claim_subscription_refund_dispatch(p_refund_id);
  elsif p_action='recover' then result:=platform_private.prepare_subscription_refund_recovery(p_refund_id);
  else result:=platform_private.record_subscription_refund_result(p_refund_id,p_result->>'shopId',(p_result->>'paymentId')::uuid,
   (p_result->>'refundId')::uuid,p_result->>'status',(p_result->>'amountMinor')::bigint,p_result->>'currency');
  end if;
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end;$$;
revoke all on function public.subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb) to service_role;
commit;
