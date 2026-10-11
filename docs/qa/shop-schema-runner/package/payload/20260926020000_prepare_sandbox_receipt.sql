begin;
create table public.billing_receipt_audit (
 order_id uuid primary key references public.billing_receipt_snapshots(order_id) on delete restrict,
 actor_id uuid not null,
 created_at timestamptz not null default statement_timestamp(),
 event text not null check(event='snapshot_prepared')
);
alter table public.billing_receipt_audit enable row level security;
revoke all on public.billing_receipt_audit from public,anon,authenticated,service_role;
create trigger receipt_audit_immutable before update or delete on public.billing_receipt_audit
 for each row execute function public.guard_fiscal_storage();

-- Sandbox only. Order identity is the idempotency key; no payment is sent.
create function public.prepare_sandbox_receipt(p_order_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.billing_receipt_snapshots%rowtype;
 actor uuid:=auth.uid(); policy uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'receipt requires read committed' using errcode='40001'; end if;
 if actor is null then raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id;
 if not found or o.actor_id is distinct from actor or public.has_organization_permission(o.organization_id,'billing.manage') is not true then
  raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if o.actor_id is distinct from actor or public.has_organization_permission(o.organization_id,'billing.manage') is not true then
  raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into s from public.billing_receipt_snapshots where order_id=p_order_id;
 if found then
  if s.email is distinct from p_email then raise exception 'receipt command conflict' using errcode='22023'; end if;
  return to_jsonb(s);
 end if;
 if p_email is null or length(p_email)>254 or p_email<>btrim(p_email)
  or p_email ~ '[[:space:][:cntrl:]]' or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then
  raise exception 'invalid receipt email' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:'||o.shop_id,0));
 select id into policy from public.billing_fiscal_policies
 where environment='sandbox' and shop_id=o.shop_id and effective_at<=statement_timestamp()
 order by effective_at desc limit 1;
 if policy is null then raise exception 'receipt policy unavailable' using errcode='22023'; end if;
 insert into public.billing_receipt_snapshots(order_id,policy_id,email,description)
 values(o.id,policy,p_email,'Квеста: подписка '||to_char(o.period_start at time zone 'UTC','YYYY-MM-DD HH24:MI')||' — '||to_char(o.period_end at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC')
 returning * into s;
 insert into public.billing_receipt_audit(order_id,actor_id,event) values(o.id,actor,'snapshot_prepared');
 return to_jsonb(s);
end; $$;
revoke all on function public.prepare_sandbox_receipt(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_sandbox_receipt(uuid,text) to authenticated;
commit;
