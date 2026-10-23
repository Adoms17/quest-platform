begin;
-- Явная единица льготного периода; старые предложения не переинтерпретируются.
alter table public.billing_sandbox_offers add column period_months integer;
alter table public.billing_sandbox_offers add constraint sandbox_offer_month_period check(
 period_months is null or (period_months>0 and
 period_end=((period_start at time zone 'Europe/Moscow')+make_interval(months=>period_months)) at time zone 'Europe/Moscow'));
create function public.preview_sandbox_discount_offer(p_organization_id uuid,p_offer_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare offer public.billing_sandbox_offers%rowtype; subscription public.organization_subscriptions%rowtype;
 plan public.billing_plan_versions%rowtype; checked jsonb; quote jsonb; used integer;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 select * into offer from public.billing_sandbox_offers where id=p_offer_id and organization_id=p_organization_id;
 if not found then raise exception 'sandbox offer unavailable' using errcode='42501'; end if;
 select * into subscription from public.organization_subscriptions where organization_id=p_organization_id;
 select * into plan from public.billing_plan_versions where id=offer.plan_version_id;
 if offer.valid_until<=clock_timestamp() or offer.period_end<=clock_timestamp() or offer.period_months is null
 or subscription.revision is distinct from offer.expected_revision or subscription.status='transition'
 or plan.plan_key='free' or not platform_private.tariff_allows_renewal(plan.id,clock_timestamp(),false) then
 return jsonb_build_object('ok',false,'reason','offer_unavailable'); end if;
 checked:=public.preview_organization_discount(p_organization_id,p_code,plan.plan_key,offer.period_months);
 if not (checked->>'ok')::boolean then return checked; end if;
 select count(*) into used from public.billing_discount_reservations
 where discount_id=(checked->>'discount_id')::uuid and state in ('reserved','consumed');
 if used>=(checked->>'eligible_periods')::integer then return jsonb_build_object('ok',false,'reason','discount_exhausted'); end if;
 quote:=platform_private.calculate_discount_amount(offer.amount_minor,(checked->>'discount_bps')::integer);
 return quote||jsonb_build_object('ok',true,'organization_id',p_organization_id,'offer_id',offer.id,
 'plan_version_id',plan.id,'discount_id',checked->>'discount_id','currency','RUB','environment','sandbox',
 'period_months',offer.period_months,'period_start',offer.period_start,'period_end',offer.period_end,
 'valid_until',offer.valid_until,'remaining_periods',(checked->>'eligible_periods')::integer-used,
 'reserved',false);
end; $$;
revoke all on function public.preview_sandbox_discount_offer(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_sandbox_discount_offer(uuid,uuid,text) to authenticated;
commit;
