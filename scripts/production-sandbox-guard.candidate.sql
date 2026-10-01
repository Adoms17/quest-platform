-- Candidate migration: deliberately outside automatic migration discovery.
-- Stage initialization and remaining sandbox paths must be reviewed before release.
begin;
-- Exact source hashes from the 324-migration baseline (PostgreSQL 17).
-- Validate every target before rewriting any body; unexpected drift fails closed.
do $baseline$
declare signature text; expected text; actual text;
begin
 for signature,expected in select key,value from jsonb_each_text($hashes$
{
  "public.begin_sandbox_refund(uuid)": "35c18b0104c1ef4d8793344d229fdd401ccaca8695fd0ce3cde2e7969b87018e",
  "public.advance_organization_trial(uuid)": "b30af47c8c38353319a158f9f36bcc69ea81dcdebbcadc141422d9c627b774a3",
  "public.begin_sandbox_payment_send(uuid)": "cc2a8f977ab777b362582c2f0072027591daf64af334364915d92a977241034e",
  "public.claim_prepayment_settlement(uuid)": "c8e72367097fe1333a7a78b68d702bfcb7203e5df6c0ad1521629b705fe15aaf",
  "public.record_sandbox_refund(uuid,uuid,text)": "e25b58b82c03c63102531653bd62557ac413f38aa1ecbab7a8c6a6abb90d996b",
  "platform_private.apply_recurring_period(uuid)": "b13e6e30b12f68c491f0007b5d368bcb36af7fab1b7f1125c02258cce66e1fea",
  "platform_private.begin_recurring_attempt(uuid)": "8e8134572e3c24632d2315e660ad16286c6d3a7cecc1844bd2b0a0dc59c313b1",
  "public.apply_sandbox_payment_event(uuid,jsonb)": "6675544b0a5ac10b5328d97294356bacb6d4ac1d4e5f23801c7b1fb1baeead1a",
  "platform_private.fulfill_discount_payment(uuid)": "f209f0bdd6791dc043af7b2041bc461f3200b3e42ad2f813fe4b6a997b59758f",
  "platform_private.run_scheduled_sandbox_orders()": "a2c25b1ca7d7945399285cd3c441e19c0b4341b6812ce53c50ea580b38fb3ffe",
  "public.reserve_sandbox_refund(uuid,uuid,bigint)": "fb4e8c8114180829288cbe06d8f7a83ef88d447aa21d4a3506956ad3befa96c4",
  "platform_private.apply_subscription_refund(uuid)": "125cf5e105fe7d114959ed0f1faeb14cd90e8832dcd23aadf6bf3e18587e0356",
  "public.prepare_fiscal_acceptance_fixture(uuid,text)": "9bbb84440a9c3e3ede3fcfbbbe0bcb006548e4f5370bc2bccc0ae988054a9e02",
  "public.record_prepayment_settlement(uuid,text,text)": "6378497609ff5f9e1177ff1f4ebeff12dd264ed4579f6505fe298bc625dcc75d",
  "platform_private.authorize_recurring_send(uuid,uuid)": "917ef173994405894788c6bc72f17bf096f82d209dd11e31b30e4796c139eee7",
  "platform_private.claim_recurring_dispatch(uuid,uuid)": "21c43ee3c071b04f6744c864125e26b0487110caa62e10ad624ddf96e798440d",
  "platform_private.defer_future_discount_payment(uuid)": "58c815411ee5d1090b1f36a8a5f680e68d85cb8ffdf497ffec4acb5a339bc8a9",
  "platform_private.record_recurring_result(uuid,jsonb)": "b0193eb6a086584bd542708422880c0d5dd09e71f55041317beadb44448672f8",
  "platform_private.fulfill_zero_discount_checkout(uuid)": "ea49e70621cdd92559c479d72d666b4381714aecd158e56d0ceb20851751699d",
  "platform_private.apply_current_subscription_refund(uuid)": "8c3630107029f77cffee82a629c92371087c48e34d46d0b06e0d2f8c548dc09c",
  "platform_private.claim_subscription_refund_dispatch(uuid)": "38b4a08d34c3c9b836e261f87c594ccbfda2bbb38df2c3b9da1ec3bebee02431",
  "platform_private.confirm_trial_checkout_replacement(uuid)": "b46d3d513869df72b0cf7da1463ba39e7a968f7723a71a8a8192d30197f1e186",
  "platform_private.run_scheduled_subscription_settlements()": "a0f2250479c25f3658a3d1b445d89dd6dc8857d3f58d7f2fb87fd7bf082cff8d",
  "platform_private.claim_subscription_fiscal_operation(uuid)": "eb89c2ba4037cb887d98bb04639fb0640259ccddde1d3aff11c6324489da01ba",
  "platform_private.check_linked_fiscal_refund_send(uuid,jsonb)": "a960dea890ebe04166753f5aeccce0c0e46a0fe73c8e6587359499addfa5a2d2",
  "platform_private.schedule_confirmed_period_after_trial(uuid)": "6a4a446246fe04ef5f108646194b23cc8638e8b8b8cbaeda5e3a4bab2845389b",
  "platform_private.apply_future_trial_subscription_refund(uuid)": "78dfc29945b533213e0f9f0762a3346a2e37b1a74225a1ee993dc355aa9b3b6e",
  "public.retry_sandbox_subscription_refund_application(text,uuid)": "13334b6af0f4857896464c12c921d91194ea1c1e7e325cacd20f5ae2609df76a",
  "platform_private.record_linked_subscription_fiscal_refund(uuid,jsonb)": "823a5c3d5096806003af1067420d5edbfee73388a40725debb757844969d5d51",
  "public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text)": "0379959bdd0619d9b5dd709a7e7da06dcf79c907420b0827594a9d8ff95233d8",
  "public.effective_trial_subscription(public.organization_subscriptions,timestamptz)": "315d7a80263d97733a90d6ef23dd092e4591059acb8ad42307727e594b34aeee",
  "platform_private.reserve_subscription_fiscal_operation(uuid,uuid,bigint,text,bigint)": "65c3a4b6bc823860ecc4013627880ca20b1c654c8f3d3032e340f64d029d214a",
  "platform_private.record_subscription_fiscal_result(uuid,uuid,text,text,bigint,text,uuid,text,text)": "8b0086346ba350a50d6ac2546c7149110aa17dad244455903aed00bc29b455df",
  "public.reserve_sandbox_payment_order(uuid,uuid,bigint,uuid,bigint,text,text,timestamptz,timestamptz)": "d3b8348096a53e79ea251e9cbd45a005470cc6583dced88a7ef1dd08f6019fd8"
}
$hashes$::jsonb) loop
  select encode(sha256(convert_to(prosrc,'UTF8')),'hex') into actual
   from pg_proc where oid=to_regprocedure(signature);
  if actual is distinct from expected then
   raise exception 'sandbox guard source hash mismatch: %',signature;
  end if;
 end loop;
end; $baseline$;
create table platform_private.billing_runtime_environment (
 singleton boolean primary key default true check(singleton),
 environment text not null check(environment in ('sandbox','production'))
);
alter table platform_private.billing_runtime_environment enable row level security;
revoke all on platform_private.billing_runtime_environment from public,anon,authenticated,service_role;

create function platform_private.require_sandbox_environment() returns void
language plpgsql security definer set search_path='' as $$
declare configured text;
begin
 -- The shared row lock serializes accepted operations with operator changes.
 select environment into configured from platform_private.billing_runtime_environment
 where singleton for share;
 if configured is distinct from 'sandbox' then
  raise exception 'sandbox environment denied' using errcode='42501';
 end if;
end;
$$;
revoke all on function platform_private.require_sandbox_environment() from public,anon,authenticated,service_role;

-- Common confirmation primitives also serve production adapters. Enforce the
-- sandbox boundary only when the persisted confirmation belongs to a sandbox
-- order. A trigger failure rolls back the preceding subscription update too.
create function platform_private.guard_sandbox_period_confirmation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.billing_sandbox_orders where id=new.confirmation_id) then
  perform platform_private.require_sandbox_environment();
 end if;
 return new;
end; $$;
revoke all on function platform_private.guard_sandbox_period_confirmation() from public,anon,authenticated,service_role;
create trigger sandbox_period_confirmation_environment
 before insert on public.billing_period_confirmations
 for each row execute function platform_private.guard_sandbox_period_confirmation();

-- Preserve signatures, ACL and existing SECURITY DEFINER bodies. Fail if the
-- expected PL/pgSQL entry marker is absent; never replace nested BEGIN blocks.
do $$
declare signature text; definition text; patched text; source text; prefix text;
begin
 foreach signature in array array[
  'public.reserve_sandbox_payment_order(uuid,uuid,bigint,uuid,bigint,text,text,timestamptz,timestamptz)',
  'public.begin_sandbox_payment_send(uuid)',
  'public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text)',
  'public.apply_sandbox_payment_event(uuid,jsonb)',
  'public.prepare_fiscal_acceptance_fixture(uuid,text)',
  'public.reserve_sandbox_refund(uuid,uuid,bigint)',
  'public.begin_sandbox_refund(uuid)',
  'public.record_sandbox_refund(uuid,uuid,text)',
  'platform_private.claim_subscription_refund_dispatch(uuid)',
  'public.claim_prepayment_settlement(uuid)',
  'public.record_prepayment_settlement(uuid,text,text)',
  'platform_private.reserve_subscription_fiscal_operation(uuid,uuid,bigint,text,bigint)',
  'platform_private.claim_subscription_fiscal_operation(uuid)',
  'platform_private.record_subscription_fiscal_result(uuid,uuid,text,text,bigint,text,uuid,text,text)',
  'platform_private.check_linked_fiscal_refund_send(uuid,jsonb)',
  'platform_private.record_linked_subscription_fiscal_refund(uuid,jsonb)',
  'platform_private.begin_recurring_attempt(uuid)',
  'platform_private.authorize_recurring_send(uuid,uuid)',
  'platform_private.claim_recurring_dispatch(uuid,uuid)',
  'platform_private.record_recurring_result(uuid,jsonb)',
  'platform_private.apply_recurring_period(uuid)',
  'platform_private.fulfill_discount_payment(uuid)',
  'platform_private.fulfill_zero_discount_checkout(uuid)',
  'platform_private.run_scheduled_sandbox_orders()',
  'platform_private.run_scheduled_subscription_settlements()',
  'public.retry_sandbox_subscription_refund_application(text,uuid)',
  'platform_private.apply_subscription_refund(uuid)',
  'platform_private.apply_current_subscription_refund(uuid)',
  'platform_private.apply_future_trial_subscription_refund(uuid)',
  'platform_private.schedule_confirmed_period_after_trial(uuid)',
  'platform_private.confirm_trial_checkout_replacement(uuid)',
  'platform_private.defer_future_discount_payment(uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  select prosrc into source from pg_proc where oid=signature::regprocedure
   and prolang=(select oid from pg_language where lanname='plpgsql');
  if source is null then raise exception 'sandbox guard requires plpgsql: %',signature; end if;
  prefix:=substring(source from E'(?is)^(.*?)\\mbegin\\M');
  -- Reject ambiguous comment/inline markers instead of silently patching them.
  -- This is a structural check for the reviewed historical bodies, not a parser.
  if prefix is null or prefix !~ E'(^|\n)[ \t]*$' then
   raise exception 'sandbox guard entry marker ambiguous: %',signature;
  end if;
  patched:=regexp_replace(source,E'\\mbegin\\M',
   E'begin\n perform platform_private.require_sandbox_environment();','i');
  if patched=source then raise exception 'sandbox guard entry marker missing: %',signature; end if;
  if (length(definition)-length(replace(definition,source,'')))/length(source)<>1 then
   raise exception 'sandbox guard source occurrence ambiguous: %',signature;
  end if;
  execute replace(definition,source,patched);
 end loop;
end;
$$;
-- STABLE entitlement projection cannot acquire row locks. Deny only the branch
-- deriving paid access from a sandbox purchase; ordinary trial remains usable.
create function platform_private.require_sandbox_projection() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from platform_private.billing_runtime_environment
  where singleton and environment='sandbox') then
  raise exception 'sandbox environment denied' using errcode='42501';
 end if;
end; $$;
revoke all on function platform_private.require_sandbox_projection() from public,anon,authenticated,service_role;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.effective_trial_subscription(public.organization_subscriptions,timestamptz)'::regprocedure);
 marker:='if found and p_at>=paid.period_start then';
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'paid projection guard marker missing or ambiguous'; end if;
 execute replace(definition,marker,marker||' perform platform_private.require_sandbox_projection();');
 definition:=pg_get_functiondef('public.advance_organization_trial(uuid)'::regprocedure);
 marker:='select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;';
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'trial runner guard marker missing or ambiguous'; end if;
 execute replace(definition,marker,
  'if exists(select 1 from platform_private.active_trial_paid_periods where organization_id=p_organization_id) then
   perform platform_private.require_sandbox_environment(); end if; '||marker);
end; $$;
commit;
