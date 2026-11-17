-- UNAPPLIED OWNER-ONLY SYNTHETIC FIXTURE, not an evidence writer capability.
-- Run only inside a separately authorized disposable DB test transaction after
-- the candidate and existing synthetic linked-refund sending/unknown setup.
-- Session input qvesta.test.recovery_context_command_id must name that fixture.
do $$
declare command uuid:=nullif(current_setting('qvesta.test.recovery_context_command_id',true),'')::uuid;
begin
 perform platform_private.require_sandbox_environment();
 if command is null or not exists(
  select 1 from public.billing_sandbox_refunds f
  join public.subscription_refund_dispatches d on d.refund_id=f.id
  join public.billing_subscription_fiscal_operation_status st on st.command_id=f.fiscal_command_id
  where f.fiscal_command_id=command and f.state='sending' and st.state='unknown'
   and d.actor_id=md5('discount-checkout-owner')::uuid
   and d.authorized_at=f.first_sent_at and st.first_sent_at=f.first_sent_at
 ) then raise exception 'synthetic sending fixture required'; end if;
 insert into platform_private.recovery_context_fixture_evidence
 (id,command_id,refund_id,provider_refund_id,dispatch_actor,authorized_at,shop_id,payment_id,
  amount_minor,payment_amount_minor,currency,body_sha256,key_digest,state,source)
 select md5('recovery-context-evidence:'||command::text)::uuid,command,f.id,
  md5('recovery-context-provider:'||command::text)::uuid,d.actor_id,d.authorized_at,o.shop_id,f.payment_id,
  f.amount_minor,o.amount_minor,o.currency,x.body_sha256,
  encode(extensions.digest(convert_to(x.idempotency_key::text,'UTF8'),'sha256'),'hex'),
  'succeeded','synthetic_owner_fixture'
 from public.billing_sandbox_refunds f join public.billing_sandbox_orders o on o.id=f.order_id
 join public.subscription_refund_dispatches d on d.refund_id=f.id
 join public.billing_subscription_fiscal_operations x on x.command_id=f.fiscal_command_id
 where x.command_id=command;
 if not found then raise exception 'synthetic sending fixture required'; end if;
end; $$;
