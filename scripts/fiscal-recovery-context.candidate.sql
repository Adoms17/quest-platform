-- UNAPPLIED LOCAL R-ONLY CANDIDATE. Outside automatic migrations and CI discovery.
-- Requires full reviewed schema + environment guard/pin. Synthetic evidence only.
-- No sender/evidence-write action, financial commit action, or new EXECUTE grant.
begin;
create table platform_private.recovery_context_fixture_evidence (
 id uuid primary key,
 command_id uuid not null unique references public.billing_subscription_fiscal_operations(command_id),
 refund_id uuid not null unique references public.subscription_refund_dispatches(refund_id),
 provider_refund_id uuid not null unique,
 dispatch_actor uuid not null references auth.users(id), authorized_at timestamptz not null,
 shop_id text not null, payment_id uuid not null,
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 payment_amount_minor bigint not null check(payment_amount_minor between amount_minor and 9007199254740991),
 currency text not null check(currency='RUB'),
 body_sha256 text not null check(body_sha256 ~ '^[0-9a-f]{64}$'),
 key_digest text not null check(key_digest ~ '^[0-9a-f]{64}$'),
 state text not null check(state='succeeded'),
 source text not null check(source='synthetic_owner_fixture')
);
alter table platform_private.recovery_context_fixture_evidence enable row level security;
revoke all on platform_private.recovery_context_fixture_evidence from public,anon,authenticated,service_role;
create trigger recovery_context_fixture_immutable before update or delete or truncate
 on platform_private.recovery_context_fixture_evidence for each statement
 execute function public.prevent_billing_plan_version_mutation();

create function platform_private.read_recovery_context(
 p_actor uuid,p_mfa bigint,p_exp bigint,p_shop text,p_command uuid,p_evidence uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
 r public.subscription_refund_requests%rowtype;
 o public.billing_sandbox_orders%rowtype;
 s public.organization_subscriptions%rowtype;
 f public.billing_sandbox_refunds%rowtype;
 x public.billing_subscription_fiscal_operations%rowtype;
 st public.billing_subscription_fiscal_operation_status%rowtype;
 d public.subscription_refund_dispatches%rowtype;
 l public.billing_subscription_fiscal_ledgers%rowtype;
 p public.billing_sandbox_payment_results%rowtype;
 e platform_private.recovery_context_fixture_evidence%rowtype;
 canonical_time text; key_hash text; evidence_json jsonb; snapshot jsonb; result jsonb; epoch numeric;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_actor is null
  or auth.uid() is distinct from p_actor or p_command is null or p_evidence is null
  or p_shop is null or p_shop !~ '^[0-9]{1,32}$' then
  raise exception 'recovery context denied' using errcode='42501'; end if;
 perform public.require_platform_owner(); -- owner advisory lock, then live owner/MFA check
 perform platform_private.require_sandbox_environment(); -- pinned singleton FOR SHARE
 -- Resolve authorized command scope BEFORE looking up evidence/provider identity.
 select r0.* into r from public.subscription_refund_requests r0
 join public.subscription_refund_reservations v on v.request_id=r0.id
 join public.billing_sandbox_refunds f0 on f0.id=v.refund_id and f0.fiscal_command_id=r0.id
 join public.billing_sandbox_orders o0 on o0.id=r0.order_id and o0.organization_id=r0.organization_id
 join public.billing_sandbox_application_scope a on a.organization_id=r0.organization_id
 where r0.id=p_command and o0.shop_id=p_shop;
 if not found then raise exception 'recovery context denied' using errcode='42501'; end if;
 select * into s from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into o from public.billing_sandbox_orders where id=r.order_id for update;
 select * into f from public.billing_sandbox_refunds where fiscal_command_id=p_command for update;
 select * into st from public.billing_subscription_fiscal_operation_status where command_id=p_command for update;
 select * into x from public.billing_subscription_fiscal_operations where command_id=p_command;
 select * into d from public.subscription_refund_dispatches where refund_id=f.id;
 select * into l from public.billing_subscription_fiscal_ledgers where order_id=o.id;
 select * into p from public.billing_sandbox_payment_results where order_id=o.id;
 select * into e from platform_private.recovery_context_fixture_evidence
  where id=p_evidence and command_id=p_command and refund_id=f.id for share;
 -- Never expose whether an evidence ID exists for another command.
 if s.organization_id is null or o.id is null or f.id is null or st.command_id is null
  or x.command_id is null or d.refund_id is null or l.order_id is null or p.order_id is null or e.id is null
  or o.organization_id is distinct from r.organization_id or o.shop_id is distinct from p_shop
  or f.order_id is distinct from o.id or x.order_id is distinct from o.id
  or x.kind is distinct from 'refund_before' or o.currency is distinct from 'RUB'
  or st.state is distinct from 'unknown' or f.state is distinct from 'sending'
  or st.provider_refund_id is not null or st.provider_receipt_id is not null or f.provider_refund_id is not null
  or st.receipt_status is not null or st.requires_review is distinct from false
  or st.first_sent_at is null or st.first_sent_at is distinct from f.first_sent_at
  or d.authorized_at is distinct from st.first_sent_at
  or p.status is distinct from 'succeeded' or p.paid is distinct from true or p.requires_review is distinct from false
  or p.shop_id is distinct from p_shop or p.payment_id is distinct from f.payment_id
  or l.payment_id is distinct from f.payment_id or l.amount_minor is distinct from o.amount_minor
  or r.amount_minor is distinct from f.amount_minor or x.amount_minor is distinct from f.amount_minor
  or f.amount_minor not between 1 and 9007199254740991 or o.amount_minor<f.amount_minor
  or o.amount_minor>9007199254740991
  or not exists(select 1 from public.subscription_refund_period_bindings b where b.request_id=r.id)
  or exists(select 1 from public.subscription_refund_applications a where a.request_id=r.id or a.refund_id=f.id)
  or exists(select 1 from public.billing_subscription_fiscal_operations q
   join public.billing_subscription_fiscal_operation_status z using(command_id)
   where q.order_id=o.id and (z.requires_review or q.kind='settlement'))
 then raise exception 'recovery context denied' using errcode='42501'; end if;
 key_hash:=encode(extensions.digest(convert_to(x.idempotency_key::text,'UTF8'),'sha256'),'hex');
 if e.dispatch_actor is distinct from d.actor_id or e.authorized_at is distinct from d.authorized_at
  or e.shop_id is distinct from p_shop or e.payment_id is distinct from f.payment_id
  or e.amount_minor is distinct from f.amount_minor or e.payment_amount_minor is distinct from o.amount_minor
  or e.currency is distinct from o.currency or e.body_sha256 is distinct from x.body_sha256
  or e.key_digest is distinct from key_hash or e.state is distinct from 'succeeded'
  or e.source is distinct from 'synthetic_owner_fixture'
  or exists(select 1 from public.billing_subscription_fiscal_operation_status z where z.provider_refund_id=e.provider_refund_id)
  or exists(select 1 from public.billing_sandbox_refunds z where z.provider_refund_id=e.provider_refund_id)
 then raise exception 'recovery context denied' using errcode='42501'; end if;
 canonical_time:=to_char(st.first_sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 evidence_json:=jsonb_build_object('id',e.id,'commandId',r.id,'dispatchId',d.refund_id,
  'providerRefundId',e.provider_refund_id,'shopId',e.shop_id,'paymentId',e.payment_id,
  'amountMinor',e.amount_minor,'paymentAmountMinor',e.payment_amount_minor,'currency',e.currency,
  'bodySha256',e.body_sha256,'keyDigest',e.key_digest,'firstSentAt',canonical_time,
  'state',e.state,'source',e.source);
 -- Scoped, versioned, explicit columns. No raw body, request snapshot or whole-row JSON.
 -- One SQL statement observes all additional related rows with one MVCC snapshot.
 select jsonb_build_object('version',1,'environment','sandbox',
  'command',jsonb_build_array(r.id,r.organization_id,r.order_id,r.amount_minor,
    x.kind,x.expected_version,x.body_sha256,key_hash,l.version,f.id,f.payment_id,
    f.state,st.state,st.receipt_status,st.requires_review,canonical_time,d.actor_id),
  'payment',jsonb_build_array(p.payment_id,p.shop_id,p.status,p.paid,p.requires_review,o.amount_minor,o.currency),
  'subscription',jsonb_build_array(s.revision,s.plan_version_id,s.status,s.period_start,s.period_end,
    s.trial_access_id,s.cancel_at_period_end,s.scheduled_plan_version_id,s.scheduled_effective_at),
  'binding',(select jsonb_build_array(b.period_order_id,b.kind,b.plan_version_id,b.period_start,b.period_end)
    from public.subscription_refund_period_bindings b where b.request_id=r.id),
  'fiscalPeers',(select coalesce(jsonb_agg(jsonb_build_array(q.command_id,q.expected_version,q.kind,q.amount_minor,
    z.state,z.requires_review,z.provider_refund_id,z.provider_receipt_id,z.receipt_status) order by q.command_id),'[]'::jsonb)
    from public.billing_subscription_fiscal_operations q join public.billing_subscription_fiscal_operation_status z using(command_id) where q.order_id=o.id),
  'unresolvedRenewals',(select coalesce(jsonb_agg(ro.id order by ro.id),'[]'::jsonb)
    from public.billing_recurring_orders ro join public.billing_recurring_dispatches rd on rd.order_id=ro.id
    where ro.organization_id=r.organization_id
     and not exists(select 1 from public.billing_period_confirmations c where c.confirmation_id=ro.id)
     and not exists(select 1 from public.billing_recurring_results rr where rr.order_id=ro.id and rr.status='canceled' and not rr.requires_review)),
  'evidence',evidence_json) into snapshot;
 result:=jsonb_build_object('environmentPin',jsonb_build_object('environment','sandbox','verified',true),
  'commandId',r.id,'evidenceId',e.id,'dispatchId',d.refund_id,'organizationId',r.organization_id,
  'orderId',o.id,'internalRefundId',f.id,'paymentId',f.payment_id,'shopId',o.shop_id,
  'kind',x.kind,'amountMinor',f.amount_minor,'paymentAmountMinor',o.amount_minor,'currency',o.currency,
  'bodySha256',x.body_sha256,'keyDigest',key_hash,'firstSentAt',canonical_time,
  'snapshotDigest',encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex'),'evidence',evidence_json);
 -- FINAL DB-CLOCK BARRIER: no lock wait, query or permission call after this block.
 -- Recheck owner/scope after all preceding waits; claims alone never establish role.
 perform public.require_platform_owner();
 perform platform_private.require_sandbox_environment();
 if not exists(select 1 from auth.users where id=p_actor)
  or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=r.organization_id)
 then raise exception 'recovery context denied' using errcode='42501'; end if;
 epoch:=extract(epoch from clock_timestamp());
 if p_mfa is null or p_mfa>epoch or p_mfa<=epoch-300 or p_exp is null or p_exp<=epoch
  or st.first_sent_at>clock_timestamp() or st.first_sent_at<=clock_timestamp()-interval '23 hours'
 then raise exception 'recovery context denied' using errcode='42501'; end if;
 return result;
exception when others then
 -- Same SQLSTATE/message for missing/foreign evidence, access, pin and state failures.
 -- Never include SQLERRM, arguments, IDs or row contents in DETAIL/HINT.
 raise exception 'recovery context denied' using errcode='42501';
end; $$;
revoke all on function platform_private.read_recovery_context(uuid,bigint,bigint,text,uuid,uuid)
 from public,anon,authenticated,service_role;

-- LOCAL capability extension: one R action using EXISTING service-only EXECUTE.
-- All existing actions/guards/claim restoration remain in their original body.
do $$
declare definition text; original_acl aclitem[]; final_acl aclitem[];
 signature regprocedure:='public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb)'::regprocedure;
 allowed text:='p_action not in (''claim'',''record'',''review'',''status'',''before_send'')';
 marker text:='if p_action=''status'' then result:=platform_private.read_linked_fiscal_refund_status(p_command_id);';
begin
 definition:=pg_get_functiondef(signature);
 select proacl into original_acl from pg_proc where oid=signature;
 if position(allowed in definition)=0 or position(marker in definition)=0
  or position('read_recovery_context' in definition)>0
  or not has_function_privilege('service_role',signature,'EXECUTE')
  or has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then
  raise exception 'recovery context prerequisite changed'; end if;
 definition:=replace(definition,allowed,'p_action not in (''claim'',''record'',''review'',''status'',''before_send'',''read_recovery_context'')');
 definition:=replace(definition,marker,$branch$if p_action='read_recovery_context' then
   if jsonb_typeof(p_result) is distinct from 'object' or (p_result-'evidenceId') is distinct from '{}'::jsonb
    or jsonb_typeof(p_result->'evidenceId') is distinct from 'string'
    or coalesce(p_result->>'evidenceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'recovery context denied' using errcode='42501'; end if;
   result:=platform_private.read_recovery_context(p_actor_user_id,p_mfa_at,p_expires_at,p_shop_id,p_command_id,(p_result->>'evidenceId')::uuid);
  elsif p_action='status' then result:=platform_private.read_linked_fiscal_refund_status(p_command_id);$branch$);
 execute definition;
 select proacl into final_acl from pg_proc where oid=signature;
 if final_acl is distinct from original_acl then raise exception 'gateway ACL changed'; end if;
end; $$;
commit;
