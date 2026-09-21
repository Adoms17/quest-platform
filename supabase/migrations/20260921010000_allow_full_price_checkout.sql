begin;
-- Общий журнал расчётов сохраняет состояние заказа без фиктивного промокода.
alter table public.billing_discount_reservations alter column discount_id drop not null;
alter table public.billing_discount_reservations add constraint full_price_reservation_shape check(
 discount_id is not null or (quote->>'discount_bps'='0' and quote->>'discount_amount_minor'='0'
 and quote->>'amount_minor'=quote->>'base_amount_minor' and (quote->>'requires_payment')::boolean) is true);

alter function public.preview_sandbox_discount_offer_before_trial(uuid,uuid,text) rename to preview_sandbox_discount_offer_with_code;
create function public.preview_sandbox_discount_offer_before_trial(p_organization_id uuid,p_offer_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare offer public.billing_sandbox_offers%rowtype; s public.organization_subscriptions%rowtype; plan public.billing_plan_versions%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if p_code is null or length(p_code)>128 then raise exception 'invalid discount checkout' using errcode='22023'; end if;
 if btrim(p_code)<>'' then return public.preview_sandbox_discount_offer_with_code(p_organization_id,p_offer_id,p_code); end if;
 select * into offer from public.billing_sandbox_offers where id=p_offer_id and organization_id=p_organization_id;
 if not found then raise exception 'sandbox offer unavailable' using errcode='42501'; end if;
 select * into s from public.organization_subscriptions where organization_id=p_organization_id;
 select * into plan from public.billing_plan_versions where id=offer.plan_version_id;
 if offer.valid_until<=clock_timestamp() or offer.period_end<=clock_timestamp() or offer.period_months is null
 or s.revision is distinct from offer.expected_revision or s.status='transition' or plan.plan_key='free'
 or not platform_private.tariff_allows_renewal(plan.id,clock_timestamp(),false) then return jsonb_build_object('ok',false,'reason','offer_unavailable'); end if;
 return jsonb_build_object('ok',true,'organization_id',p_organization_id,'offer_id',offer.id,'plan_version_id',plan.id,
 'discount_id',null,'base_amount_minor',offer.amount_minor,'discount_amount_minor',0,'amount_minor',offer.amount_minor,
 'discount_bps',0,'requires_payment',true,'currency','RUB','environment','sandbox','period_months',offer.period_months,
 'period_start',offer.period_start,'period_end',offer.period_end,'valid_until',offer.valid_until,'remaining_periods',0,'reserved',false);
end; $$;
revoke all on function public.preview_sandbox_discount_offer_before_trial(uuid,uuid,text) from public,anon,authenticated,service_role;

-- Подписка блокируется общим accept до резервирования, retry обрабатывается там же.
create function platform_private.reserve_full_price_checkout(p_order_id uuid,p_organization_id uuid,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_quote->>'discount_bps' is distinct from '0' or p_quote->>'discount_id' is not null
 or (p_quote->>'amount_minor')::bigint<=0 then raise exception 'invalid full price quote' using errcode='22023'; end if;
 insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote)
 values(p_order_id,null,p_organization_id,jsonb_build_object('organization_id',p_organization_id,'offer_id',p_quote->'offer_id','kind','full_price'),p_quote);
 return p_quote;
end; $$;
revoke all on function platform_private.reserve_full_price_checkout(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('platform_private.accept_discount_checkout(uuid,uuid,uuid,text)'::regprocedure);
 marker:='amount:=platform_private.reserve_discount_period(order_id,p_organization_id,(checked->>''discount_id'')::uuid,plan_key,offer.period_months,offer.amount_minor);';
 if position(marker in definition)=0 then raise exception 'checkout reservation patch missing'; end if;
 execute replace(definition,marker,'if btrim(p_code)='''' then amount:=platform_private.reserve_full_price_checkout(order_id,p_organization_id,checked); else '||marker||' end if;');
 definition:=pg_get_functiondef('platform_private.accept_reviewed_discount_checkout(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 marker:='where value=''null''::jsonb';
 if position(marker in definition)=0 then raise exception 'review fields patch missing'; end if;
 execute replace(definition,marker,'where value=''null''::jsonb and not (key=''discount_id'' and expected->>''discount_bps''=''0'')');
 definition:=pg_get_functiondef('public.accept_sandbox_checkout_offer(uuid,uuid,uuid)'::regprocedure);
 marker:='result:=public.reserve_sandbox_payment_order';
 if position(marker in definition)=0 then raise exception 'legacy trial guard patch missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.organization_subscriptions where organization_id=p_organization_id and status=''trial'') then raise exception ''trial requires reviewed checkout'' using errcode=''55000''; end if; '||marker);
end $patch$;
commit;