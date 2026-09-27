begin;
create table public.billing_fiscal_policy_audit (
 policy_id uuid primary key references public.billing_fiscal_policies(id),
 actor_id uuid not null,
 created_at timestamptz not null default statement_timestamp()
);
alter table public.billing_fiscal_policy_audit enable row level security;
revoke all on public.billing_fiscal_policy_audit from public,anon,authenticated,service_role;
create trigger fiscal_policy_audit_immutable before update or delete on public.billing_fiscal_policy_audit
 for each row execute function public.guard_fiscal_storage();

create function public.create_sandbox_fiscal_policy(p_id uuid,p_shop_id text,p_effective_at timestamptz,
 p_vat_code integer,p_payment_subject text,p_payment_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.billing_fiscal_policies%rowtype;
begin
 perform public.require_platform_owner();
 perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:'||coalesce(p_shop_id,''),0));
 select * into p from public.billing_fiscal_policies where id=p_id;
 if found then
  if row(p.environment,p.shop_id,p.effective_at,p.vat_code,p.payment_subject,p.payment_mode)
   is distinct from row('sandbox'::text,p_shop_id,p_effective_at,p_vat_code,p_payment_subject,p_payment_mode) then
   raise exception 'fiscal policy command conflict' using errcode='22023'; end if;
  return to_jsonb(p);
 end if;
 if p_id is null or p_effective_at is null or not isfinite(p_effective_at) or p_effective_at<=clock_timestamp() then
  raise exception 'future fiscal policy required' using errcode='22023'; end if;
 insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
 values(p_id,'sandbox',p_shop_id,p_effective_at,p_vat_code,p_payment_subject,p_payment_mode) returning * into p;
 insert into public.billing_fiscal_policy_audit(policy_id,actor_id) values(p.id,auth.uid());
 return to_jsonb(p);
end; $$;
revoke all on function public.create_sandbox_fiscal_policy(uuid,text,timestamptz,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_sandbox_fiscal_policy(uuid,text,timestamptz,integer,text,text) to authenticated;
commit;
