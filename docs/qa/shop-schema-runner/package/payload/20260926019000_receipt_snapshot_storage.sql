begin;
-- Closed storage only: no RPC or payment path is enabled by this migration.
create table public.billing_fiscal_policies (
 id uuid primary key default gen_random_uuid(),
 environment text not null check(environment='sandbox'),
 shop_id text not null check(shop_id ~ '^[0-9]+$'),
 effective_at timestamptz not null check(isfinite(effective_at)),
 vat_code integer not null check(vat_code between 1 and 12),
 payment_subject text not null check(payment_subject in ('service','intellectual_activity','property_right')),
 payment_mode text not null check(payment_mode in ('full_payment','full_prepayment')),
 created_at timestamptz not null default statement_timestamp(),
 unique(environment,shop_id,effective_at)
);
create table public.billing_receipt_snapshots (
 order_id uuid primary key references public.billing_sandbox_orders(id) on delete restrict,
 policy_id uuid not null references public.billing_fiscal_policies(id) on delete restrict,
 prepared_at timestamptz not null default statement_timestamp(),
 email text not null check(length(email) between 3 and 254 and email=btrim(email)
   and email !~ '[[:space:][:cntrl:]]' and email ~ '^[^@]+@[^@]+\.[^@]+$'),
 description text not null check(length(description) between 1 and 128 and length(btrim(description))>0 and description !~ '[[:cntrl:]]'),
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 currency text not null check(currency='RUB'),
 vat_code integer not null,
 payment_subject text not null,
 payment_mode text not null
);
alter table public.billing_fiscal_policies enable row level security;
alter table public.billing_receipt_snapshots enable row level security;
revoke all on public.billing_fiscal_policies,public.billing_receipt_snapshots from public,anon,authenticated,service_role;

create function public.guard_fiscal_storage() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'fiscal record immutable' using errcode='55000';
end; $$;
revoke all on function public.guard_fiscal_storage() from public,anon,authenticated,service_role;
create trigger fiscal_policy_immutable before update or delete on public.billing_fiscal_policies for each row execute function public.guard_fiscal_storage();
create trigger receipt_snapshot_immutable before update or delete on public.billing_receipt_snapshots for each row execute function public.guard_fiscal_storage();

create function public.prepare_receipt_snapshot() returns trigger language plpgsql set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; p public.billing_fiscal_policies%rowtype;
begin
 select * into o from public.billing_sandbox_orders where id=new.order_id for update;
 if not found then raise exception 'receipt order missing' using errcode='23503'; end if;
 if o.first_sent_at is not null or o.state<>'reserved' then
  raise exception 'receipt must precede payment send' using errcode='55000'; end if;
 new.prepared_at:=statement_timestamp();
 select * into p from public.billing_fiscal_policies
 where environment='sandbox' and shop_id=o.shop_id and effective_at<=new.prepared_at
 order by effective_at desc limit 1;
 if not found or p.id is distinct from new.policy_id then
  raise exception 'receipt policy unavailable' using errcode='22023'; end if;
 new.amount_minor:=o.amount_minor; new.currency:=o.currency;
 new.vat_code:=p.vat_code; new.payment_subject:=p.payment_subject; new.payment_mode:=p.payment_mode;
 return new;
end; $$;
revoke all on function public.prepare_receipt_snapshot() from public,anon,authenticated,service_role;
create trigger receipt_snapshot_prepare before insert on public.billing_receipt_snapshots for each row execute function public.prepare_receipt_snapshot();
commit;
