begin;
-- Новый реестр не преобразует прежние billing_promotions / бесплатные доступы.
-- Один персональный код задаёт условия для одной организации и одного plan_key.
create table public.billing_discount_codes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 plan_key text not null check(plan_key ~ '^[a-z][a-z0-9_]*$' and plan_key<>'free'),
 code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
 discount_bps integer not null check(discount_bps between 1 and 10000),
 eligible_periods integer not null check(eligible_periods>0),
 period_months integer not null check(period_months>0),
 activate_before timestamptz not null check(isfinite(activate_before)),
 issuer_id uuid not null references auth.users(id) on delete restrict,
 issue_command_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(issuer_id,issue_command_id)
);
alter table public.billing_discount_codes enable row level security;
revoke all on public.billing_discount_codes from public,anon,authenticated,service_role;
create trigger billing_discount_terms_immutable before update or delete or truncate on public.billing_discount_codes
 for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.validate_discount_plan() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.billing_plan_versions where plan_key=new.plan_key and plan_key<>'free') then
 raise exception 'unknown discount plan' using errcode='23514'; end if;
 return new;
end; $$;
revoke all on function platform_private.validate_discount_plan() from public,anon,authenticated,service_role;
create trigger billing_discount_plan before insert on public.billing_discount_codes
 for each row execute function platform_private.validate_discount_plan();

-- Только внутренняя арифметика: не проверка права на код и не выдача доступа.
-- Цена задаётся в копейках; округляется сумма скидки до ближайшей копейки.
create function platform_private.calculate_discount_amount(p_base_minor bigint,p_discount_bps integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare reduction bigint;
begin
 if p_base_minor is null or p_base_minor<0 or p_base_minor>9007199254740991
 or p_discount_bps is null or p_discount_bps not between 1 and 10000 then
 raise exception 'invalid discount calculation' using errcode='22023'; end if;
 reduction:=floor((p_base_minor::numeric*p_discount_bps+5000)/10000)::bigint;
 return jsonb_build_object('base_amount_minor',p_base_minor,'discount_bps',p_discount_bps,
 'discount_amount_minor',reduction,'amount_minor',p_base_minor-reduction,
 'requires_payment',p_base_minor-reduction>0);
end; $$;
revoke all on function platform_private.calculate_discount_amount(bigint,integer) from public,anon,authenticated,service_role;
commit;
