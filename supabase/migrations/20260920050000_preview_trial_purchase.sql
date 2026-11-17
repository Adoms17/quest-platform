begin;
-- Предварительный просмотр не создаёт заказ и не прекращает trial.
-- Его результат нужно повторно проверить под блокировкой при принятии заказа.
create function public.preview_organization_trial_purchase(p_organization_id uuid,p_target_plan_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; g public.billing_trial_access%rowtype;
 target public.billing_plan_versions%rowtype; source public.billing_plan_versions%rowtype;
 measured timestamptz:=statement_timestamp(); same_plan boolean;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 select * into s from public.organization_subscriptions where organization_id=p_organization_id;
 select * into g from public.billing_trial_access where id=s.trial_access_id;
 if g.id is null or g.access_kind<>'trial' or g.state not in ('scheduled','active')
 or not public.trial_access_matches(s,g) or measured<g.starts_at or measured>=g.ends_at then
 raise exception 'active trial required' using errcode='22023'; end if;
 select * into target from public.billing_plan_versions where id=p_target_plan_version_id;
 if target.id is null or target.plan_key='free' or
 not platform_private.tariff_allows_renewal(target.id,measured,false) then
 raise exception 'current paid tariff required' using errcode='22023'; end if;
 select * into source from public.billing_plan_versions where id=g.plan_version_id;
 same_plan:=source.plan_key=target.plan_key;
 return jsonb_build_object('organization_id',p_organization_id,'subscription_revision',s.revision,
 'trial_access_id',g.id,'trial_plan_version_id',g.plan_version_id,'target_plan_version_id',target.id,
 'target_plan_key',target.plan_key,'target_name',target.display_name,
 'transition',case when same_plan then 'after_trial' else 'replace_trial_on_payment' end,
 'trial_ends_at',g.ends_at,'paid_starts_at',case when same_plan then g.ends_at else null end,
 'paid_starts_on_payment',not same_plan,'trial_remaining_seconds',extract(epoch from g.ends_at-measured),
 'trial_remaining_preserved',same_plan,'measured_at',measured);
end; $$;
revoke all on function public.preview_organization_trial_purchase(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_organization_trial_purchase(uuid,uuid) to authenticated;
commit;
