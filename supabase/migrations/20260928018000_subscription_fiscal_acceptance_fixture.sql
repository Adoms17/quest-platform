begin;
-- Operator-provisioned allowlist only; no seed or browser/service write grants.
create table public.billing_fiscal_acceptance_fixtures (
 id uuid primary key,
 organization_id uuid not null unique references public.organizations(id),
 actor_id uuid not null references auth.users(id),
 plan_version_id uuid not null references public.billing_plan_versions(id),
 expected_revision bigint not null check(expected_revision>=0),
 expires_at timestamptz not null check(isfinite(expires_at)),
 order_id uuid unique references public.billing_sandbox_orders(id)
);
alter table public.billing_fiscal_acceptance_fixtures enable row level security;
revoke all on public.billing_fiscal_acceptance_fixtures from public,anon,authenticated,service_role;
create function platform_private.guard_fiscal_acceptance_fixture() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise exception 'fiscal fixture immutable' using errcode='55000'; end if;
 if (to_jsonb(new)-'order_id') is distinct from (to_jsonb(old)-'order_id') or old.order_id is not null or new.order_id is null then
  raise exception 'fiscal fixture immutable' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function platform_private.guard_fiscal_acceptance_fixture() from public,anon,authenticated,service_role;
create trigger fiscal_acceptance_fixture_immutable before update or delete on public.billing_fiscal_acceptance_fixtures
 for each row execute function platform_private.guard_fiscal_acceptance_fixture();
create function public.prepare_fiscal_acceptance_fixture(p_fixture_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.billing_fiscal_acceptance_fixtures%rowtype; s public.organization_subscriptions%rowtype;
 o public.billing_sandbox_orders%rowtype; saved jsonb; started timestamptz; policy uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'fixture requires read committed' using errcode='40001'; end if;
 perform public.require_platform_owner();
 select * into f from public.billing_fiscal_acceptance_fixtures where id=p_fixture_id for update;
 if not found or f.actor_id is distinct from auth.uid() or f.expires_at<=clock_timestamp()
  or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=f.organization_id)
  or public.has_organization_permission(f.organization_id,'billing.manage') is not true then
  raise exception 'fiscal fixture denied' using errcode='42501'; end if;
 if f.order_id is not null then
  select * into o from public.billing_sandbox_orders where id=f.order_id;
  -- Existing immutable receipt enforces identical contact even after sending.
  perform public.prepare_sandbox_receipt(o.id,p_email);
 else
  select * into s from public.organization_subscriptions where organization_id=f.organization_id for update;
  if s.organization_id is null or s.status<>'free' or s.revision<>f.expected_revision
   or s.period_start is not null or s.period_end is not null or s.trial_access_id is not null
   or s.scheduled_plan_version_id is not null
   or exists(select 1 from public.billing_sandbox_orders where organization_id=f.organization_id)
   or exists(select 1 from public.billing_trial_paid_periods where organization_id=f.organization_id) then
   raise exception 'fiscal fixture organization not empty' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:1467641',0));
  policy:=public.select_subscription_fiscal_policy('1467641',statement_timestamp());
  if not exists(select 1 from public.billing_fiscal_policy_models where policy_id=policy and model_version='subscription_access_v1') then
   raise exception 'fiscal fixture model unavailable' using errcode='55000'; end if;
  started:=date_trunc('milliseconds',clock_timestamp());
  saved:=public.reserve_sandbox_payment_order(f.organization_id,f.id,f.expected_revision,f.plan_version_id,99000,
   '1467641','https://stage.qvesta.ru/organization/billing',started,started+interval '30 minutes');
  select * into o from public.billing_sandbox_orders where id=(saved->>'id')::uuid;
  perform public.prepare_sandbox_receipt(o.id,p_email);
  if not exists(select 1 from public.billing_subscription_fiscal_terms where order_id=o.id and policy_id=policy
   and period_start=o.period_start and period_end=o.period_end) then
   raise exception 'fiscal fixture terms missing' using errcode='55000'; end if;
  update public.billing_fiscal_acceptance_fixtures set order_id=o.id where id=f.id;
 end if;
 return jsonb_build_object('fixtureId',f.id,'orderId',o.id,'organizationId',f.organization_id,'amountMinor',o.amount_minor,
  'periodStart',o.period_start,'periodEnd',o.period_end,'shopId',o.shop_id,'environment','sandbox');
end; $$;
revoke all on function public.prepare_fiscal_acceptance_fixture(uuid,text) from public,anon,authenticated,service_role;
create function public.prepare_fiscal_acceptance_from_gateway(
 p_actor_user_id uuid,p_mfa_at bigint,p_expires_at bigint,p_fixture_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true);
 previous_claims text:=current_setting('request.jwt.claims',true); result jsonb;
 epoch numeric:=extract(epoch from clock_timestamp());
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
  or p_mfa_at is null or p_mfa_at>epoch or p_mfa_at<=epoch-300
  or p_expires_at is null or p_expires_at<=epoch or p_fixture_id is null then
  raise exception 'invalid fiscal fixture context' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_user_id,'role','authenticated','aal','aal2','exp',p_expires_at,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',p_mfa_at)))::text,true);
 begin
  result:=public.prepare_fiscal_acceptance_fixture(p_fixture_id,p_email);
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true); raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end; $$;
revoke all on function public.prepare_fiscal_acceptance_from_gateway(uuid,bigint,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_fiscal_acceptance_from_gateway(uuid,bigint,bigint,uuid,text) to service_role;
commit;
