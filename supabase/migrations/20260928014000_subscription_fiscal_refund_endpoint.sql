begin;
-- These actions expose only a safe status and a fresh authorization check, never a second claim.
create function platform_private.check_linked_fiscal_refund_send(p_command_id uuid,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; x public.billing_subscription_fiscal_operations%rowtype;
 s public.billing_subscription_fiscal_operation_status%rowtype; f public.billing_sandbox_refunds%rowtype;
begin
 select * into r from public.subscription_refund_requests where id=p_command_id;
 if not found then raise exception 'fiscal send denied' using errcode='55000'; end if;
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 perform 1 from public.billing_sandbox_orders where id=r.order_id for update;
 select * into x from public.billing_subscription_fiscal_operations where command_id=p_command_id;
 select * into s from public.billing_subscription_fiscal_operation_status where command_id=p_command_id;
 select * into f from public.billing_sandbox_refunds where fiscal_command_id=p_command_id;
 if x.command_id is null or s.command_id is null or f.id is null
  or s.state<>'unknown' or s.first_sent_at is null or s.first_sent_at<=clock_timestamp()-interval '23 hours'
  or s.provider_refund_id is not null or s.provider_receipt_id is not null or s.requires_review
  or f.state<>'sending' or f.provider_refund_id is not null or f.first_sent_at is distinct from s.first_sent_at
  or p_expected->>'key' is distinct from x.idempotency_key::text
  or p_expected->>'sha256' is distinct from x.body_sha256
  or (p_expected->>'firstSentAt')::timestamptz is distinct from s.first_sent_at
  or exists(select 1 from public.billing_subscription_fiscal_operations q
   join public.billing_subscription_fiscal_operation_status t using(command_id) where q.order_id=r.order_id and t.requires_review)
  or not exists(select 1 from public.billing_sandbox_payment_results p where p.order_id=r.order_id
   and p.payment_id=f.payment_id and p.status='succeeded' and p.paid and not p.requires_review) then
  raise exception 'fiscal send denied' using errcode='55000'; end if;
 perform platform_private.check_subscription_refund_access(r.id);
 return jsonb_build_object('authorized',true,'commandId',p_command_id,'key',x.idempotency_key,'sha256',x.body_sha256);
end; $$;
revoke all on function platform_private.check_linked_fiscal_refund_send(uuid,jsonb) from public,anon,authenticated,service_role;

create function platform_private.read_linked_fiscal_refund_status(p_command_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('commandId',x.command_id,'refundId',f.id,'state',f.state,
  'receiptStatus',s.receipt_status,'operationState',s.state,'requiresReview',(s.requires_review or exists(select 1 from public.billing_subscription_fiscal_operations q
   join public.billing_subscription_fiscal_operation_status t using(command_id) where q.order_id=x.order_id and t.requires_review)),
  'accessEffect',case when exists(select 1 from public.subscription_refund_applications a where a.refund_id=f.id)
   then case when f.state='review' then 'applied_review_required' else 'applied' end
   when f.state in ('succeeded','review') then 'review_required' else 'not_applied' end,
  'environment','sandbox')
 from public.billing_subscription_fiscal_operations x
 join public.billing_subscription_fiscal_operation_status s using(command_id)
 join public.billing_sandbox_refunds f on f.fiscal_command_id=x.command_id where x.command_id=p_command_id;
$$;
revoke all on function platform_private.read_linked_fiscal_refund_status(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text;
 marker text:='if p_action=''claim'' then result:=platform_private.claim_linked_subscription_fiscal_refund(p_command_id);';
begin
 definition:=pg_get_functiondef('public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb)'::regprocedure);
 if position(marker in definition)=0 or position('p_action not in (''claim'',''record'',''review'')' in definition)=0 then
  raise exception 'fiscal gateway prerequisite changed'; end if;
 definition:=replace(definition,'p_action not in (''claim'',''record'',''review'')','p_action not in (''claim'',''record'',''review'',''status'',''before_send'')');
 definition:=replace(definition,marker,'if p_action=''status'' then result:=platform_private.read_linked_fiscal_refund_status(p_command_id);
  elsif p_action=''before_send'' then result:=platform_private.check_linked_fiscal_refund_send(p_command_id,p_result);
  elsif p_action=''claim'' then result:=platform_private.claim_linked_subscription_fiscal_refund(p_command_id);');
 execute definition;
end; $$;
commit;
