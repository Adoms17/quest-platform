-- LOCAL OWNER-FIXTURE PROTOTYPE ONLY. Not an automatic migration or API.
begin;
create table platform_private.recovery_a_evidence (
 id uuid primary key, command_id uuid not null unique,
 provider_id uuid not null unique, operation jsonb not null, result jsonb not null
);
create table platform_private.recovery_a_decisions (
 event_id uuid primary key, command_id uuid not null unique,
 evidence_id uuid not null unique references platform_private.recovery_a_evidence(id),
 digest text not null, outcome jsonb not null
);
alter table platform_private.recovery_a_evidence enable row level security;
alter table platform_private.recovery_a_decisions enable row level security;
revoke all on platform_private.recovery_a_evidence,platform_private.recovery_a_decisions from public,anon,authenticated,service_role;
create trigger recovery_a_evidence_immutable before update or delete or truncate
 on platform_private.recovery_a_evidence for each statement execute function public.prevent_billing_plan_version_mutation();
create trigger recovery_a_decision_immutable before update or delete or truncate
 on platform_private.recovery_a_decisions for each statement execute function public.prevent_billing_plan_version_mutation();

-- Conservative whole-fixture CAS: unrelated writes may reject, never permit stale recovery.
create function platform_private.recovery_a_snapshot() returns text
language plpgsql security definer set search_path='' as $$
declare names text[]:=array['billing_sandbox_orders','billing_sandbox_payment_results','billing_sandbox_refunds',
 'billing_subscription_fiscal_ledgers','billing_subscription_fiscal_operations','billing_subscription_fiscal_operation_status',
 'subscription_refund_requests','subscription_refund_dispatches','subscription_refund_period_bindings',
 'subscription_refund_reservations','subscription_refund_applications','organization_subscriptions',
 'billing_period_confirmations','billing_review_resolutions','billing_sandbox_application_scope',
 'billing_recurring_orders','billing_recurring_dispatches','billing_recurring_results'];
 name text; value jsonb; snapshot jsonb:='{}';
begin
 foreach name in array names loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',name) into value;
  snapshot:=snapshot||jsonb_build_object(name,value);
 end loop;
 return encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
end; $$;
revoke all on function platform_private.recovery_a_snapshot() from public,anon,authenticated,service_role;

create function platform_private.recover_fiscal_response_a(
 p_actor uuid,p_mfa bigint,p_exp bigint,p_shop text,p_command uuid,p_evidence uuid,
 p_event uuid,p_snapshot text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; x public.billing_subscription_fiscal_operations%rowtype;
 f public.billing_sandbox_refunds%rowtype; s public.billing_subscription_fiscal_operation_status%rowtype;
 e platform_private.recovery_a_evidence%rowtype; prior platform_private.recovery_a_decisions%rowtype;
 digest text; outcome jsonb; payment uuid;
begin
 -- Existing gateway validates actor, expiry, platform owner + recent MFA and scope.
 perform public.subscription_fiscal_refund_from_gateway(p_actor,p_mfa,p_exp,p_shop,'status',p_command,null);
 perform platform_private.require_sandbox_environment();
 if p_event is null or p_evidence is null or p_snapshot is null or p_result is null then
  raise exception 'recovery input invalid' using errcode='22023'; end if;
 select * into r from public.subscription_refund_requests where id=p_command;
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 perform 1 from public.billing_sandbox_orders where id=r.order_id for update;
 select * into f from public.billing_sandbox_refunds where fiscal_command_id=p_command for update;
 select * into s from public.billing_subscription_fiscal_operation_status where command_id=p_command for update;
 digest:=encode(extensions.digest(convert_to(jsonb_build_array(p_actor,p_shop,p_command,p_evidence,p_snapshot,p_result)::text,'UTF8'),'sha256'),'hex');
 select * into prior from platform_private.recovery_a_decisions where event_id=p_event;
 if found then
  if prior.digest<>digest then raise exception 'recovery event conflict' using errcode='22023'; end if;
  return prior.outcome||jsonb_build_object('replay',true);
 end if;
 select * into x from public.billing_subscription_fiscal_operations where command_id=p_command;
 select * into e from platform_private.recovery_a_evidence where id=p_evidence for update;
 select payment_id into payment from public.billing_subscription_fiscal_ledgers where order_id=r.order_id;
 if x.command_id is null or e.id is null or f.id is null or s.command_id is null
  or e.command_id<>p_command or x.kind<>'refund_before' or s.state<>'unknown' or f.state<>'sending'
  or s.first_sent_at is null or s.first_sent_at<=clock_timestamp()-interval '23 hours'
  or f.first_sent_at is distinct from s.first_sent_at
  or s.provider_refund_id is not null or s.provider_receipt_id is not null or f.provider_refund_id is not null
  or exists(select 1 from public.billing_subscription_fiscal_operations q join public.billing_subscription_fiscal_operation_status z using(command_id) where q.order_id=r.order_id and (z.requires_review or q.kind='settlement'))
  or exists(select 1 from public.subscription_refund_applications where request_id=r.id)
  or not exists(select 1 from public.subscription_refund_dispatches where refund_id=f.id and authorized_at=s.first_sent_at)
  or p_snapshot is distinct from platform_private.recovery_a_snapshot()
  or e.operation->>'commandId' is distinct from p_command::text
  or e.operation->>'shopId' is distinct from p_shop
  or e.operation->>'paymentId' is distinct from payment::text
  or e.operation->>'key' is distinct from x.idempotency_key::text
  or e.operation->>'sha256' is distinct from x.body_sha256
  or e.operation->'body' is distinct from x.body
  or (e.operation->>'firstSentAt')::timestamptz is distinct from s.first_sent_at
 then raise exception 'recovery evidence or state unconfirmed' using errcode='55000'; end if;
 if p_result is distinct from e.result or p_result->>'commandId' is distinct from p_command::text
  or p_result->>'shopId' is distinct from p_shop or p_result->>'paymentId' is distinct from payment::text
  or p_result->>'bodySha256' is distinct from x.body_sha256
  or p_result->'amountMinor' is distinct from to_jsonb(x.amount_minor)
  or p_result->>'refundId' is distinct from e.provider_id::text
  or p_result->>'state' is distinct from 'succeeded'
  or p_result->>'receiptStatus' is distinct from 'unknown' or p_result->'receiptId' is distinct from 'null'::jsonb
 then raise exception 'recovery result mismatch' using errcode='22023'; end if;
 -- Reuse gateway: fresh DB authorization again and existing atomic money/access semantics.
 outcome:=public.subscription_fiscal_refund_from_gateway(p_actor,p_mfa,p_exp,p_shop,'record',p_command,p_result);
 insert into platform_private.recovery_a_decisions values(p_event,p_command,p_evidence,digest,outcome);
 return outcome||jsonb_build_object('replay',false);
end; $$;
revoke all on function platform_private.recover_fiscal_response_a(uuid,bigint,bigint,text,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
