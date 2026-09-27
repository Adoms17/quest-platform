begin;
create table public.billing_recurring_receipt_snapshots (
 order_id uuid primary key references public.billing_recurring_orders(id),
 source_order_id uuid not null references public.billing_receipt_snapshots(order_id),
 policy_id uuid not null references public.billing_fiscal_policies(id),
 prepared_at timestamptz not null default statement_timestamp(),
 email text not null,
 description text not null,
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 currency text not null check(currency='RUB'),
 vat_code integer not null check(vat_code between 1 and 12),
 payment_subject text not null check(payment_subject in ('service','intellectual_activity','property_right')),
 payment_mode text not null check(payment_mode in ('full_payment','full_prepayment'))
);
alter table public.billing_recurring_receipt_snapshots enable row level security;
revoke all on public.billing_recurring_receipt_snapshots from public,anon,authenticated,service_role;
create trigger recurring_receipt_immutable before update or delete on public.billing_recurring_receipt_snapshots
 for each row execute function public.guard_fiscal_storage();

-- Preparation must precede begin_attempt: a missing email must not consume the
-- only authorized dispatch attempt. Existing snapshots may be read after send.
create function public.prepare_recurring_receipt(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; o public.billing_sandbox_orders%rowtype;
 s public.billing_recurring_receipt_snapshots%rowtype; source public.billing_receipt_snapshots%rowtype;
 policy public.billing_fiscal_policies%rowtype; amount bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'receipt requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then raise exception 'recurring order unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 select * into s from public.billing_recurring_receipt_snapshots where order_id=r.id;
 if found then return to_jsonb(s); end if;
 amount:=(r.quote->>'amount_minor')::bigint;
 if amount=0 then return jsonb_build_object('state','zero_amount'); end if;
 if amount is null or amount<1 or amount>9007199254740991 then raise exception 'invalid recurring receipt amount' using errcode='22023'; end if;
 if exists(select 1 from public.billing_recurring_attempts where order_id=r.id) then
  raise exception 'receipt must precede recurring attempt' using errcode='55000'; end if;
 select * into o from public.billing_sandbox_orders where id=r.source_order_id and organization_id=r.organization_id;
 if not found or o.plan_version_id is distinct from r.plan_version_id then
  raise exception 'recurring receipt source mismatch' using errcode='22023'; end if;
 if exists(select 1 from public.billing_recurring_revocations where consent_id=r.consent_id)
  or exists(select 1 from public.billing_recurring_cancellations where order_id=r.id) then
  raise exception 'recurring receipt unavailable' using errcode='55000'; end if;
 select * into source from public.billing_receipt_snapshots where order_id=o.id;
 if not found then raise exception 'recurring receipt contact unavailable' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:'||o.shop_id,0));
 select * into policy from public.billing_fiscal_policies where environment='sandbox' and shop_id=o.shop_id and effective_at<=statement_timestamp()
 order by effective_at desc limit 1;
 if not found then raise exception 'receipt policy unavailable' using errcode='55000'; end if;
 insert into public.billing_recurring_receipt_snapshots(order_id,source_order_id,policy_id,email,description,amount_minor,currency,vat_code,payment_subject,payment_mode)
 values(r.id,o.id,policy.id,source.email,'Квеста: подписка '||to_char(r.period_start at time zone 'UTC','YYYY-MM-DD HH24:MI')||' — '||to_char(r.period_end at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC',amount,'RUB',policy.vat_code,policy.payment_subject,policy.payment_mode)
 returning * into s;
 return to_jsonb(s);
end; $$;
revoke all on function public.prepare_recurring_receipt(uuid) from public,anon,authenticated;
grant execute on function public.prepare_recurring_receipt(uuid) to service_role;
commit;
