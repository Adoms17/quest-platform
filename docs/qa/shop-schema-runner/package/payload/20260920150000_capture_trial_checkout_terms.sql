begin;
-- Вызывается внутри принятия заказа под блокировкой подписки, до резерва скидки.
create function platform_private.capture_trial_checkout_terms(p_organization_id uuid,p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; g public.billing_trial_access%rowtype;
 offer public.billing_sandbox_offers%rowtype; terms jsonb;
begin
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 select * into offer from public.billing_sandbox_offers where id=p_offer_id and organization_id=p_organization_id;
 if not found then raise exception 'sandbox offer unavailable' using errcode='42501'; end if;
 if s.trial_access_id is null and s.status<>'trial' then return '{}'::jsonb; end if;
 terms:=public.preview_organization_trial_purchase(p_organization_id,offer.plan_version_id);
 select * into g from public.billing_trial_access where id=s.trial_access_id;
 if clock_timestamp()>=g.ends_at then raise exception 'active trial required' using errcode='22023'; end if;
 if terms->>'transition'='after_trial' and offer.period_start is distinct from g.ends_at then
 raise exception 'trial checkout period mismatch' using errcode='22023'; end if;
 -- Для другого тарифа даты окончательного периода определит подтверждение покупки.
 -- Абсолютные даты исходного предложения не должны преждевременно завершать trial.
 return jsonb_build_object('trial_purchase',jsonb_build_object(
 'access_id',g.id,'generation',g.generation,'subscription_revision',s.revision,
 'source_plan_version_id',g.plan_version_id,'target_plan_version_id',offer.plan_version_id,
 'trial_starts_at',g.starts_at,'trial_ends_at',g.ends_at,
 'transition',terms->>'transition','period_months',offer.period_months,
 'paid_starts_at',terms->'paid_starts_at',
 'paid_starts_on_confirmation',(terms->>'paid_starts_on_payment')::boolean,
 'trial_remaining_preserved',(terms->>'trial_remaining_preserved')::boolean));
end; $$;
revoke all on function platform_private.capture_trial_checkout_terms(uuid,uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='amount:=platform_private.reserve_discount_period';
begin
 definition:=pg_get_functiondef('platform_private.accept_discount_checkout(uuid,uuid,uuid,text)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'trial checkout capture marker missing'; end if;
 execute replace(definition,marker,'checked:=checked||platform_private.capture_trial_checkout_terms(p_organization_id,p_offer_id); '||marker);
end; $$;
commit;
