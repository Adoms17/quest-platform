begin;
-- MODEL-01 storage only. No policy seed, public RPC, scheduler or dispatch.
create table public.billing_fiscal_policy_models (
 policy_id uuid primary key references public.billing_fiscal_policies(id) on delete restrict,
 product_kind text not null check(product_kind='subscription'),
 model_version text not null check(model_version='subscription_access_v1'),
 seller_tax_regime text not null check(seller_tax_regime='ausn'),
 settlement_basis text not null check(settlement_basis='period_end'),
 created_at timestamptz not null default statement_timestamp()
);
create table public.billing_subscription_fiscal_terms (
 order_id uuid primary key references public.billing_receipt_snapshots(order_id) on delete restrict,
 policy_id uuid not null references public.billing_fiscal_policy_models(policy_id) on delete restrict,
 period_start timestamptz not null check(isfinite(period_start)),
 period_end timestamptz not null check(isfinite(period_end) and period_end>period_start),
 created_at timestamptz not null default statement_timestamp()
);
alter table public.billing_fiscal_policy_models enable row level security;
alter table public.billing_subscription_fiscal_terms enable row level security;
revoke all on public.billing_fiscal_policy_models,public.billing_subscription_fiscal_terms from public,anon,authenticated,service_role;
create trigger fiscal_policy_model_immutable before update or delete on public.billing_fiscal_policy_models
 for each row execute function public.guard_fiscal_storage();
create trigger subscription_fiscal_terms_immutable before update or delete on public.billing_subscription_fiscal_terms
 for each row execute function public.guard_fiscal_storage();

-- A model can only accompany a new future policy; never classify history retroactively.
create function public.validate_subscription_fiscal_model() returns trigger
language plpgsql set search_path='' as $$
declare p public.billing_fiscal_policies%rowtype;
begin
 select * into p from public.billing_fiscal_policies where id=new.policy_id for update;
 if not found or p.environment is distinct from 'sandbox'
  or p.effective_at<=clock_timestamp() or p.vat_code is distinct from 1
  or p.payment_subject is distinct from 'service' or p.payment_mode is distinct from 'full_prepayment' then
  raise exception 'subscription fiscal policy incompatible' using errcode='22023';
 end if;
 new.created_at:=statement_timestamp();
 return new;
end; $$;
revoke all on function public.validate_subscription_fiscal_model() from public,anon,authenticated,service_role;
create trigger subscription_fiscal_model_validate before insert on public.billing_fiscal_policy_models
 for each row execute function public.validate_subscription_fiscal_model();

-- Called inside a future controlled preparation RPC. Never trust caller-supplied dates.
create function public.prepare_subscription_fiscal_terms() returns trigger
language plpgsql set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.billing_receipt_snapshots%rowtype;
begin
 select * into o from public.billing_sandbox_orders where id=new.order_id for update;
 if not found or o.state is distinct from 'reserved' or o.first_sent_at is not null then
  raise exception 'fiscal terms must precede payment send' using errcode='55000';
 end if;
 select * into s from public.billing_receipt_snapshots where order_id=o.id;
 if not found or s.policy_id is distinct from new.policy_id
  or s.amount_minor is distinct from o.amount_minor or s.currency is distinct from o.currency then
  raise exception 'subscription fiscal snapshot mismatch' using errcode='22023';
 end if;
 new.period_start:=o.period_start;
 new.period_end:=o.period_end;
 new.created_at:=statement_timestamp();
 return new;
end; $$;
revoke all on function public.prepare_subscription_fiscal_terms() from public,anon,authenticated,service_role;
create trigger subscription_fiscal_terms_prepare before insert on public.billing_subscription_fiscal_terms
 for each row execute function public.prepare_subscription_fiscal_terms();
commit;
