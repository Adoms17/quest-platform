-- Apply after the environment guard, before one-time environment provisioning.
-- Environment identity is not a sales switch. Historical environment transitions
-- require a separately reviewed data migration, not an UPDATE to this singleton.
begin;
create function platform_private.check_initial_billing_environment() returns trigger
language plpgsql security definer set search_path='' as $$
declare relation_name text; populated boolean;
begin
 if new.environment<>'production' then return new; end if;
 -- Explicit conservative inventory: reject operational history, not catalog or
 -- organization rows. Lock each source against concurrent provisioning.
 for relation_name in
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and (
   c.relname like 'billing_sandbox_%' or c.relname like 'billing_recurring_%'
   or c.relname in ('billing_discount_checkouts','billing_trial_paid_periods',
    'billing_fiscal_acceptance_fixtures','billing_receipt_snapshots',
    'billing_subscription_fiscal_operations','billing_period_confirmations',
    'billing_confirmation_inbox','billing_review_resolutions'))
  order by c.relname
 loop
  execute format('lock table public.%I in share mode',relation_name);
  execute format('select exists(select 1 from public.%I)',relation_name) into populated;
  if populated then raise exception 'production environment requires clean billing history: %',relation_name using errcode='55000'; end if;
 end loop;
 lock table public.billing_fiscal_policies in share mode;
 if exists(select 1 from public.billing_fiscal_policies where environment='sandbox') then
  raise exception 'production environment requires clean fiscal policies' using errcode='55000';
 end if;
 return new;
end; $$;
revoke all on function platform_private.check_initial_billing_environment() from public,anon,authenticated,service_role;
create trigger billing_environment_initial_check before insert on platform_private.billing_runtime_environment
 for each row execute function platform_private.check_initial_billing_environment();
create function platform_private.protect_billing_environment_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and new is not distinct from old then return new; end if;
 raise exception 'billing environment identity immutable' using errcode='55000';
end; $$;
revoke all on function platform_private.protect_billing_environment_identity() from public,anon,authenticated,service_role;
create trigger billing_environment_identity_immutable
 before update or delete on platform_private.billing_runtime_environment
 for each row execute function platform_private.protect_billing_environment_identity();
create trigger billing_environment_identity_no_truncate
 before truncate on platform_private.billing_runtime_environment
 for each statement execute function platform_private.protect_billing_environment_identity();
commit;
