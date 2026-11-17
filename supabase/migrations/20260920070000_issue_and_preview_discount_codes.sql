begin;
create table public.billing_discount_checks (
 actor_id uuid primary key references auth.users(id), window_start timestamptz not null,
 attempts integer not null check(attempts between 0 and 10)
);
alter table public.billing_discount_checks enable row level security;
revoke all on public.billing_discount_checks from public,anon,authenticated,service_role;
create function public.issue_organization_discount(p_organization_id uuid,p_plan_key text,p_discount_bps integer,
 p_eligible_periods integer,p_period_months integer,p_activate_before timestamptz,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.billing_discount_codes%rowtype; raw_code text;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_organization_id is null or p_plan_key is null
 or p_discount_bps is null or p_discount_bps not between 1 and 10000
 or p_eligible_periods is null or p_eligible_periods<1 or p_period_months is null or p_period_months<1
 or p_activate_before is null or not isfinite(p_activate_before) then
 raise exception 'invalid discount issue' using errcode='22023'; end if;
 select * into existing from public.billing_discount_codes where issuer_id=auth.uid() and issue_command_id=p_command_id;
 if found then
 if row(existing.organization_id,existing.plan_key,existing.discount_bps,existing.eligible_periods,existing.period_months,existing.activate_before)
 is distinct from row(p_organization_id,p_plan_key,p_discount_bps,p_eligible_periods,p_period_months,p_activate_before) then
 raise exception 'discount command conflict' using errcode='22023'; end if;
 return jsonb_build_object('discount_id',existing.id,'already_issued',true,'code',null); end if;
 if p_activate_before<=clock_timestamp() then raise exception 'discount activation deadline expired' using errcode='22023'; end if;
 raw_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
 insert into public.billing_discount_codes(organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
 values(p_organization_id,p_plan_key,encode(extensions.digest(raw_code,'sha256'),'hex'),p_discount_bps,p_eligible_periods,p_period_months,p_activate_before,auth.uid(),p_command_id)
 returning * into existing;
 return jsonb_build_object('discount_id',existing.id,'already_issued',false,'code',raw_code);
end; $$;
revoke all on function public.issue_organization_discount(uuid,text,integer,integer,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_organization_discount(uuid,text,integer,integer,integer,timestamptz,uuid) to authenticated;

-- Проверка не активирует код и не расходует льготный период. Отказы возвращаются,
-- чтобы транзакция сохранила счётчик перебора; код не записывается в журнал.
create function public.preview_organization_discount(p_organization_id uuid,p_code text,p_plan_key text,p_period_months integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare measured timestamptz; limiter public.billing_discount_checks%rowtype; discount public.billing_discount_codes%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':discount-check',0));
 measured:=clock_timestamp();
 select * into limiter from public.billing_discount_checks where actor_id=auth.uid();
 if not found or measured>=limiter.window_start+interval '15 minutes' then
 insert into public.billing_discount_checks(actor_id,window_start,attempts) values(auth.uid(),measured,0)
 on conflict(actor_id) do update set window_start=excluded.window_start,attempts=0 returning * into limiter; end if;
 if limiter.attempts>=10 then return jsonb_build_object('ok',false,'reason','rate_limited'); end if;
 update public.billing_discount_checks set attempts=attempts+1 where actor_id=auth.uid();
 if p_code is null or length(p_code)>128 then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
 select * into discount from public.billing_discount_codes where organization_id=p_organization_id
 and code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
 and plan_key=p_plan_key and period_months=p_period_months and activate_before>measured;
 if not found then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
 return jsonb_build_object('ok',true,'organization_id',p_organization_id,'discount_id',discount.id,
 'plan_key',discount.plan_key,'discount_bps',discount.discount_bps,'eligible_periods',discount.eligible_periods,
 'period_months',discount.period_months,'activate_before',discount.activate_before);
end; $$;
revoke all on function public.preview_organization_discount(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_organization_discount(uuid,text,text,integer) to authenticated;
commit;
