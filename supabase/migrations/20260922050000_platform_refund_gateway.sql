begin;
-- Параметры личности передаёт только доверенный сервер ПОСЛЕ проверки JWT.
create function public.sandbox_refund_from_gateway(p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_action text,p_refund_id uuid,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
 or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300
 or p_expires_at is null or p_expires_at<=epoch
 or p_action is null or p_action not in ('read','begin','record','reject')
 or p_refund_id is null then raise exception 'invalid refund gateway context' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id,'role','authenticated','aal','aal2','exp',p_expires_at,
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',p_mfa_at)))::text,true);
 begin
  perform public.require_platform_owner();
  -- Шлюз админки не принимает старые резервы операторского механизма.
  if not exists(select 1 from public.platform_refund_commands where refund_id=p_refund_id) then
   raise exception 'confirmed refund required' using errcode='42501';
  end if;
  if p_action='read' then result:=public.read_sandbox_refund(p_refund_id);
  elsif p_action='begin' then result:=public.begin_sandbox_refund(p_refund_id);
  elsif p_action='reject' then result:=public.reject_sandbox_refund(p_refund_id);
  else result:=public.record_sandbox_refund(p_refund_id,(p_result->>'refundId')::uuid,p_result->>'status');
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
revoke all on function public.sandbox_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sandbox_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb) to service_role;
commit;
