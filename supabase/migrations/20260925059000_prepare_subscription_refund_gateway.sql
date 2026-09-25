begin;
-- Trusted server only; identity is supplied after JWT verification, never from the request body.
create function public.prepare_subscription_refund_from_gateway(
 p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_action text,
 p_organization_id uuid,p_order_id uuid,p_command_id uuid default null,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb; refund_id uuid;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
 or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300 or p_expires_at is null or p_expires_at<=epoch
 or p_action is null or p_action not in ('request','reserve') or p_organization_id is null or p_order_id is null
 or (p_action='request' and (p_command_id is null or p_request_id is not null))
 or (p_action='reserve' and (p_request_id is null or p_command_id is not null)) then
 raise exception 'invalid refund preparation context' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id,'role','authenticated','aal','aal2','exp',p_expires_at,
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',p_mfa_at)))::text,true);
 begin
  perform public.require_platform_owner();
  if not exists(select 1 from public.billing_sandbox_orders o join public.billing_sandbox_application_scope s on s.organization_id=o.organization_id
   where o.id=p_order_id and o.organization_id=p_organization_id) then
   raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
  if p_action='request' then
   result:=public.request_platform_subscription_refund(p_organization_id,p_order_id,p_command_id);
   -- Expose only fields needed to review the calculation, not internal actor/payment data.
   result:=jsonb_build_object('request_id',result->'id','amount_minor',result->'amount_minor',
    'requested_at',result->'requested_at','policy',result->'policy','period_start',result#>'{snapshot,period_start}',
    'period_end',result#>'{snapshot,period_end}','currency','RUB','reserved',false,'access_effect','unchanged');
  else
   if not exists(select 1 from public.subscription_refund_requests r where r.id=p_request_id and r.order_id=p_order_id and r.organization_id=p_organization_id) then
    raise exception 'subscription refund request scope denied' using errcode='42501'; end if;
   refund_id:=public.reserve_platform_subscription_refund(p_request_id);
   result:=jsonb_build_object('request_id',p_request_id,'refund_id',refund_id,'access_effect','unchanged');
  end if;
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true); raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end; $$;
revoke all on function public.prepare_subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid,uuid) to service_role;
commit;
