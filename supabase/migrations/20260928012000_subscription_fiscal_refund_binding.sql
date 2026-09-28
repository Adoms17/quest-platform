begin;
-- Link a modeled fiscal reserve to the existing monetary/access request atomically.
-- No send/result gateway is granted by this migration.
alter table public.billing_sandbox_refunds add column fiscal_command_id uuid unique
 references public.billing_subscription_fiscal_operations(command_id);

create or replace function platform_private.guard_legacy_fiscal_ledger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.billing_sandbox_orders where id=new.order_id for update;
 if tg_table_name='billing_sandbox_refunds' then
  if tg_op='UPDATE' then
   if old.fiscal_command_id is not null or new.fiscal_command_id is not null then
    raise exception 'linked fiscal refund execution not enabled' using errcode='55000'; end if;
  elsif new.fiscal_command_id is not null then
   if new.state='reserved' and new.provider_refund_id is null and new.first_sent_at is null
    and exists(select 1 from public.billing_subscription_fiscal_operations x
     join public.billing_subscription_fiscal_operation_status s using(command_id)
     join public.billing_subscription_fiscal_ledgers l on l.order_id=x.order_id
     join public.subscription_refund_requests r on r.id=x.command_id
     where x.command_id=new.fiscal_command_id and x.command_id=new.command_id
      and x.order_id=new.order_id and x.kind in ('refund_before','refund_after')
      and x.amount_minor=new.amount_minor and l.payment_id=new.payment_id
      and r.order_id=x.order_id and r.amount_minor=x.amount_minor
      and new.actor_id=auth.uid() and s.state='reserved' and s.first_sent_at is null and not s.requires_review) then
    return new;
   end if;
   raise exception 'invalid linked fiscal refund' using errcode='55000';
  end if;
 end if;
 if exists(select 1 from public.billing_subscription_fiscal_ledgers where order_id=new.order_id) then
  raise exception 'fiscal ledger owns order' using errcode='55000'; end if;
 return new;
end; $$;

-- Reuse the existing owner, binding, access preflight, snapshot and money checks.
-- Exact markers fail deployment if the prerequisite implementation has changed.
do $$
declare definition text;
 old_retry text:='if found then return existing; end if;';
 old_insert text:='insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id)';
 old_values text:='values(o.id,auth.uid(),request.id,request.amount_minor,payment.payment_id)';
begin
 definition:=pg_get_functiondef('public.reserve_platform_subscription_refund(uuid)'::regprocedure);
 if position(old_retry in definition)=0 or position(old_insert in definition)=0 or position(old_values in definition)=0
  or position('perform platform_private.bind_subscription_refund_period(p_request_id);' in definition)=0
  or position('perform platform_private.check_subscription_refund_access(request.id);' in definition)=0 then
  raise exception 'fiscal refund reservation prerequisite changed'; end if;
 definition:=replace(definition,'public.reserve_platform_subscription_refund(', 'platform_private.reserve_linked_subscription_fiscal_refund(');
 definition:=replace(definition,old_retry,'if found then
  if not exists(select 1 from public.billing_sandbox_refunds where id=existing and fiscal_command_id=request.id) then
   raise exception ''legacy refund cannot be relinked'' using errcode=''55000''; end if;
  return existing; end if;');
 definition:=replace(definition,old_insert,'
 if exists(select 1 from public.billing_subscription_fiscal_operations x where x.order_id=o.id and x.kind<>''settlement''
  and not exists(select 1 from public.billing_sandbox_refunds f where f.fiscal_command_id=x.command_id)) then
  raise exception ''unlinked fiscal refund exists'' using errcode=''55000''; end if;
 perform platform_private.reserve_subscription_fiscal_operation(o.id,request.id,
  coalesce((select version from public.billing_subscription_fiscal_ledgers where order_id=o.id),0),''refund'',request.amount_minor);
 insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id,fiscal_command_id)');
 definition:=replace(definition,old_values,'values(o.id,auth.uid(),request.id,request.amount_minor,payment.payment_id,request.id)');
 execute definition;
end; $$;
revoke all on function platform_private.reserve_linked_subscription_fiscal_refund(uuid) from public,anon,authenticated,service_role;

-- Trusted server supplies identity only after JWT verification. No client amounts or bodies.
create function public.prepare_linked_fiscal_refund_from_gateway(
 p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_shop_id text,
 p_organization_id uuid,p_order_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb; refund_id uuid;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
  or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300
  or p_expires_at is null or p_expires_at<=epoch or p_shop_id is null
  or p_organization_id is null or p_order_id is null or p_request_id is null then
  raise exception 'invalid fiscal refund preparation context' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id,'role','authenticated','aal','aal2','exp',p_expires_at,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',p_mfa_at)))::text,true);
 begin
  perform public.require_platform_owner();
  if not exists(select 1 from public.billing_sandbox_orders o
   join public.billing_sandbox_application_scope s on s.organization_id=o.organization_id
   join public.subscription_refund_requests r on r.order_id=o.id and r.organization_id=o.organization_id
   join public.billing_subscription_fiscal_terms t on t.order_id=o.id
   where o.id=p_order_id and o.organization_id=p_organization_id and o.shop_id=p_shop_id and r.id=p_request_id) then
   raise exception 'fiscal refund scope denied' using errcode='42501'; end if;
  refund_id:=platform_private.reserve_linked_subscription_fiscal_refund(p_request_id);
  result:=jsonb_build_object('requestId',p_request_id,'commandId',p_request_id,'refundId',refund_id,
   'state','reserved','accessEffect','unchanged','environment','sandbox');
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true); raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end; $$;
revoke all on function public.prepare_linked_fiscal_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_linked_fiscal_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid) to service_role;
commit;
