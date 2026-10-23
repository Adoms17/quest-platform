begin;
-- Keep historical requested_at as server registration time. Unknown historical receipt times stay NULL.
alter table public.subscription_refund_requests
 add column received_at timestamptz,
 add column receipt_source text,
 add constraint subscription_refund_receipt_time_check check (
  (received_at is null and receipt_source is null) or
  (received_at is not null and receipt_source is not null and receipt_source in ('email','inapp')
   and isfinite(received_at) and received_at<=requested_at));
comment on column public.subscription_refund_requests.requested_at is 'Server registration time; preserved for existing clients and rows.';
comment on column public.subscription_refund_requests.received_at is 'Confirmed email receipt instant, or server receipt instant for in-app requests; NULL for unknown historical input.';
-- Immutable row retains actor_id, source, both times and calculation snapshot as the audit record.
create function public.request_platform_subscription_refund(p_organization_id uuid,p_order_id uuid,p_command_id uuid,p_receipt_source text,p_received_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.subscription_refund_requests%rowtype;
 o public.billing_sandbox_orders%rowtype; payment public.billing_sandbox_payment_results%rowtype;
 at_time timestamptz; registered_time timestamptz; start_ms numeric; end_ms numeric; at_ms numeric;
 refunded bigint; pending bigint; amount bigint; entitled bigint; result public.subscription_refund_requests%rowtype;
begin
 perform public.require_platform_owner();
 if p_organization_id is null or p_order_id is null or p_command_id is null then
  raise exception 'invalid subscription refund request' using errcode='22023'; end if;
 if p_receipt_source is null or p_receipt_source not in ('email','inapp')
  or (p_receipt_source='email' and (p_received_at is null or not isfinite(p_received_at)))
  or (p_receipt_source='inapp' and p_received_at is not null) then
  raise exception 'invalid refund receipt time' using errcode='PT400'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':subscription-refund:'||p_command_id::text,0));
 select * into prior from public.subscription_refund_requests where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.order_id<>p_order_id or prior.organization_id<>p_organization_id then
   raise exception 'subscription refund request conflict' using errcode='22023'; end if;
  if not coalesce((prior.receipt_source is null and p_receipt_source='inapp')
   or (prior.receipt_source=p_receipt_source and (p_receipt_source='inapp' or prior.received_at=p_received_at)),false) then
   raise exception 'subscription refund receipt conflict' using errcode='PT409'; end if;
  return to_jsonb(prior)||jsonb_build_object('state','requested','reserved',false,'access_effect','unchanged');
 end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not found or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then
  raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
 select * into prior from public.subscription_refund_requests where order_id=o.id;
 if found then if not coalesce((prior.receipt_source is null and p_receipt_source='inapp')
   or (prior.receipt_source=p_receipt_source and (p_receipt_source='inapp' or prior.received_at=p_received_at)),false) then
   raise exception 'subscription refund receipt conflict' using errcode='PT409'; end if;
  return to_jsonb(prior)||jsonb_build_object('state','requested','reserved',false,'access_effect','unchanged'); end if;
 select * into payment from public.billing_sandbox_payment_results where order_id=o.id;
 if payment.order_id is null or payment.status<>'succeeded' or not payment.paid or payment.requires_review then
  raise exception 'sandbox payment not refundable' using errcode='22023'; end if;
 if o.period_start is null or o.period_end is null or not isfinite(o.period_start) or not isfinite(o.period_end)
  or o.period_end<=o.period_start or o.currency<>'RUB' then
  raise exception 'invalid refund period' using errcode='22023'; end if;
 select coalesce(sum(amount_minor) filter(where state='succeeded'),0),
  coalesce(sum(amount_minor) filter(where state not in ('succeeded','canceled','rejected')),0)
 into refunded,pending from public.billing_sandbox_refunds where order_id=o.id;
 if pending>0 then raise exception 'subscription refund pending' using errcode='55000'; end if;
 if refunded>o.amount_minor then raise exception 'invalid refund balance' using errcode='22023'; end if;
 registered_time:=date_trunc('milliseconds',clock_timestamp());
 if p_receipt_source='email' and p_received_at>registered_time then
  raise exception 'invalid refund receipt time' using errcode='PT400'; end if;
 at_time:=case when p_receipt_source='email' then p_received_at else registered_time end;
 start_ms:=floor(extract(epoch from o.period_start)*1000);
 end_ms:=floor(extract(epoch from o.period_end)*1000);
 at_ms:=floor(extract(epoch from at_time)*1000);
 if end_ms<=start_ms then raise exception 'invalid refund period' using errcode='22023'; end if;
 entitled:=round(o.amount_minor::numeric*greatest(0,least(end_ms-start_ms,end_ms-at_ms))/(end_ms-start_ms));
 amount:=least(entitled,o.amount_minor-refunded);
 insert into public.subscription_refund_requests(actor_id,command_id,organization_id,order_id,requested_at,received_at,receipt_source,policy,snapshot,amount_minor)
 values(auth.uid(),p_command_id,p_organization_id,o.id,registered_time,at_time,p_receipt_source,'subscription-prorata-v1',
  jsonb_build_object('payment_id',payment.payment_id,'paid_minor',o.amount_minor,'refunded_minor',refunded,
   'period_start',o.period_start,'period_end',o.period_end,'entitlement_minor',entitled,'currency',o.currency,'received_at',at_time,'receipt_source',p_receipt_source,
   'registered_at',registered_time,'registered_by',auth.uid()),amount)
 returning * into result;
 return to_jsonb(result)||jsonb_build_object('state','requested','reserved',false,'access_effect','unchanged');
end; $$;

revoke all on function public.request_platform_subscription_refund(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
-- Compatible server-time path: ordinary clients still cannot execute either overload.
create or replace function public.request_platform_subscription_refund(p_organization_id uuid,p_order_id uuid,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.request_platform_subscription_refund(p_organization_id,p_order_id,p_command_id,'inapp',null);
end; $$;
revoke all on function public.request_platform_subscription_refund(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.prepare_subscription_refund_from_gateway(
 p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_action text,
 p_organization_id uuid,p_order_id uuid,p_command_id uuid,p_request_id uuid,p_receipt_source text,p_received_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb; refund_id uuid;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
 or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300 or p_expires_at is null or p_expires_at<=epoch
 or p_action is null or p_action not in ('request','reserve') or p_organization_id is null or p_order_id is null
 or (p_action='request' and (p_command_id is null or p_request_id is not null))
 or (p_action='reserve' and (p_request_id is null or p_command_id is not null or p_receipt_source is not null or p_received_at is not null)) then
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
   result:=public.request_platform_subscription_refund(p_organization_id,p_order_id,p_command_id,p_receipt_source,p_received_at);
   -- Expose only fields needed to review the calculation, not internal actor/payment data.
   result:=jsonb_build_object('request_id',result->'id','amount_minor',result->'amount_minor',
    'requested_at',result->'requested_at','registered_at',result->'requested_at',
    'received_at',result->'received_at','receipt_source',result->'receipt_source','policy',result->'policy','period_start',result#>'{snapshot,period_start}',
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

revoke all on function public.prepare_subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.prepare_subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid,uuid,text,timestamptz) to service_role;
commit;
