begin;
-- The linked path may advance money only alongside the persisted fiscal lifecycle.
do $$
declare definition text; marker text:='raise exception ''linked fiscal refund execution not enabled'' using errcode=''55000'';';
begin
 definition:=pg_get_functiondef('platform_private.guard_legacy_fiscal_ledger()'::regprocedure);
 if position(marker in definition)=0 then raise exception 'linked fiscal guard prerequisite changed'; end if;
 definition:=replace(definition,marker,'
 if old.fiscal_command_id=new.fiscal_command_id
  and (to_jsonb(new)-''state''-''updated_at''-''first_sent_at''-''provider_refund_id'')=
      (to_jsonb(old)-''state''-''updated_at''-''first_sent_at''-''provider_refund_id'')
  and exists(select 1 from public.billing_subscription_fiscal_operation_status s
   where s.command_id=new.fiscal_command_id and s.first_sent_at=new.first_sent_at
    and ((old.state=''reserved'' and new.state=''sending'' and s.state=''unknown''
      and old.first_sent_at is null and old.provider_refund_id is null and new.provider_refund_id is null and not s.requires_review)
     or (old.first_sent_at=new.first_sent_at and s.provider_refund_id=new.provider_refund_id
      and (old.provider_refund_id is null or old.provider_refund_id=new.provider_refund_id)
      and ((old.state=''sending'' and new.state=''pending'' and s.state in (''pending'',''succeeded'',''canceled''))
       or (old.state in (''pending'',''succeeded'',''canceled'') and new.state=s.state))))) then return new; end if;
 '||marker);
 execute definition;
 -- An old endpoint must not send a different body/key for a linked reserve, even after claim.
 definition:=pg_get_functiondef('public.subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb)'::regprocedure);
 marker:='perform public.require_platform_owner();';
 if position(marker in definition)=0 then raise exception 'legacy refund gateway prerequisite changed'; end if;
 execute replace(definition,marker,marker||'
 if exists(select 1 from public.billing_sandbox_refunds where id=p_refund_id and fiscal_command_id is not null) then
  raise exception ''linked fiscal refund requires fiscal gateway'' using errcode=''55000''; end if;');
end; $$;

create function platform_private.claim_linked_subscription_fiscal_refund(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; f public.billing_sandbox_refunds%rowtype;
 operation jsonb; sent timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 perform public.require_platform_owner();
 select r0.* into r from public.subscription_refund_requests r0
 join public.subscription_refund_reservations l on l.request_id=r0.id
 join public.billing_sandbox_refunds f0 on f0.id=l.refund_id and f0.fiscal_command_id=r0.id
 where r0.id=p_command_id;
 if not found then raise exception 'linked fiscal refund unavailable' using errcode='55000'; end if;
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 perform 1 from public.billing_sandbox_orders where id=r.order_id for update;
 select * into f from public.billing_sandbox_refunds where fiscal_command_id=r.id for update;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=r.organization_id) then
  raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
 if f.state='reserved' then perform platform_private.check_subscription_refund_access(r.id); end if;
 operation:=platform_private.claim_subscription_fiscal_operation(p_command_id);
 if operation->>'action'='send' then
  if f.state<>'reserved' or f.first_sent_at is not null or f.provider_refund_id is not null then
   raise exception 'linked fiscal claim conflict' using errcode='55000'; end if;
  sent:=(operation->>'firstSentAt')::timestamptz;
  insert into public.subscription_refund_dispatches(refund_id,actor_id,authorized_at) values(f.id,auth.uid(),sent);
  update public.billing_sandbox_refunds set state='sending',first_sent_at=sent,updated_at=sent where id=f.id;
 end if;
 return operation;
end; $$;
revoke all on function platform_private.claim_linked_subscription_fiscal_refund(uuid) from public,anon,authenticated,service_role;

-- Commit verified fiscal identity and monetary success before applying access.
-- The existing access resolver preserves money on domain review and makes retries idempotent.
create function platform_private.record_linked_subscription_fiscal_refund(p_command_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; f public.billing_sandbox_refunds%rowtype;
 s public.billing_subscription_fiscal_operation_status%rowtype; result_state text; money jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 select r0.* into r from public.subscription_refund_requests r0
 join public.subscription_refund_reservations l on l.request_id=r0.id
 join public.billing_sandbox_refunds f0 on f0.id=l.refund_id and f0.fiscal_command_id=r0.id
 where r0.id=p_command_id;
 if not found then raise exception 'linked fiscal refund unavailable' using errcode='55000'; end if;
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 perform 1 from public.billing_sandbox_orders where id=r.order_id for update;
 select * into f from public.billing_sandbox_refunds where fiscal_command_id=r.id for update;
 if p_result->>'commandId' is distinct from p_command_id::text then
  raise exception 'fiscal result invalid' using errcode='22023'; end if;
 result_state:=platform_private.record_subscription_fiscal_result(p_command_id,(p_result->>'paymentId')::uuid,
  p_result->>'shopId',p_result->>'bodySha256',(p_result->>'amountMinor')::bigint,p_result->>'state',
  (p_result->>'refundId')::uuid,p_result->>'receiptId',p_result->>'receiptStatus');
 select * into s from public.billing_subscription_fiscal_operation_status where command_id=p_command_id;
 -- Always use the persisted verified state, never a conflicting incoming status.
 if s.provider_refund_id is not null and s.state in ('pending','succeeded','canceled') then
  money:=platform_private.record_subscription_refund_result(f.id,p_result->>'shopId',f.payment_id,
   s.provider_refund_id,s.state,f.amount_minor,'RUB');
 end if;
 return jsonb_build_object('state',result_state,'receiptStatus',s.receipt_status,
  'accessState',coalesce(money->>'access_state','not_applied'));
end; $$;
revoke all on function platform_private.record_linked_subscription_fiscal_refund(uuid,jsonb) from public,anon,authenticated,service_role;
-- A linked monetary row is already accounted for in the fiscal ledger; never count it twice.
do $$
declare definition text; marker text:='if exists(select 1 from public.billing_sandbox_refunds where order_id=o.id and state not in (''canceled'',''rejected''))';
begin
 definition:=pg_get_functiondef('platform_private.reserve_subscription_fiscal_operation(uuid,uuid,bigint,text,bigint)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'fiscal balance prerequisite changed'; end if;
 execute replace(definition,marker,'
 if exists(select 1 from public.billing_sandbox_refunds f where f.order_id=o.id and f.fiscal_command_id is not null
  and not exists(select 1 from public.billing_subscription_fiscal_operations x
   join public.billing_subscription_fiscal_operation_status s using(command_id)
   join public.billing_subscription_fiscal_ledgers linked_ledger on linked_ledger.order_id=x.order_id
   where x.command_id=f.fiscal_command_id and x.order_id=f.order_id and x.amount_minor=f.amount_minor
    and linked_ledger.payment_id=f.payment_id and x.kind<>''settlement''
    and (f.state=s.state or (f.state=''sending'' and s.state=''unknown'')))) then
  raise exception ''linked fiscal money state mismatch'' using errcode=''55000''; end if;
 if exists(select 1 from public.billing_sandbox_refunds where order_id=o.id and fiscal_command_id is null and state not in (''canceled'',''rejected''))');
end; $$;
-- Service-only boundary. Actor claims come from the verified JWT, shop from server config.
create function public.subscription_fiscal_refund_from_gateway(
 p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_shop_id text,
 p_action text,p_command_id uuid,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
  or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300
  or p_expires_at is null or p_expires_at<=epoch or p_shop_id is null or p_command_id is null
  or p_action is null or p_action not in ('claim','record','review') then
  raise exception 'invalid fiscal refund gateway context' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id,'role','authenticated','aal','aal2','exp',p_expires_at,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',p_mfa_at)))::text,true);
 begin
  perform public.require_platform_owner();
  if not exists(select 1 from public.subscription_refund_requests r
   join public.subscription_refund_reservations l on l.request_id=r.id
   join public.billing_sandbox_refunds f on f.id=l.refund_id and f.fiscal_command_id=r.id
   join public.billing_sandbox_orders o on o.id=r.order_id and o.organization_id=r.organization_id
   join public.billing_sandbox_application_scope s on s.organization_id=o.organization_id
   where r.id=p_command_id and o.shop_id=p_shop_id) then
   raise exception 'fiscal refund scope denied' using errcode='42501'; end if;
  if p_action='claim' then result:=platform_private.claim_linked_subscription_fiscal_refund(p_command_id);
  elsif p_action='record' then
   if p_result->>'shopId' is distinct from p_shop_id then raise exception 'fiscal result invalid' using errcode='22023'; end if;
   result:=platform_private.record_linked_subscription_fiscal_refund(p_command_id,p_result);
  else
   perform platform_private.mark_subscription_fiscal_review(p_command_id,p_result->>'reason');
   result:=jsonb_build_object('state','review');
  end if;
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true); raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end; $$;
revoke all on function public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb) to service_role;
commit;
