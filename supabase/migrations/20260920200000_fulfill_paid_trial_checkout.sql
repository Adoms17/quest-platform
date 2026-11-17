begin;
create function platform_private.has_verified_discount_payment(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_discount_checkouts c
 join public.billing_discount_payment_links l on l.checkout_id=c.id
 join public.billing_sandbox_orders o on o.id=l.payment_order_id
 join public.billing_sandbox_payment_results r on r.order_id=o.id
 join public.billing_sandbox_application_scope a on a.organization_id=c.organization_id
 where c.id=p_order_id and o.organization_id=c.organization_id and o.offer_id=c.offer_id
 and o.amount_minor=(c.quote->>'amount_minor')::bigint and o.amount_minor>0 and o.currency='RUB'
 and o.first_sent_at is not null and r.shop_id=o.shop_id and r.status='succeeded' and r.paid and not r.requires_review);
$$;
revoke all on function platform_private.has_verified_discount_payment(uuid) from public,anon,authenticated,service_role;
-- Общие исполнители условий trial: нулевой заказ либо проверенный денежный платёж.
alter function platform_private.confirm_zero_trial_replacement(uuid) rename to confirm_trial_checkout_replacement;
alter function platform_private.schedule_zero_period_after_trial(uuid) rename to schedule_confirmed_period_after_trial;
do $$
declare definition text; signature text; marker text;
begin
 foreach signature in array array['platform_private.confirm_trial_checkout_replacement(uuid)','platform_private.schedule_confirmed_period_after_trial(uuid)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 marker:='(c.quote->>''amount_minor'')::bigint is distinct from 0';
 if position(marker in definition)=0 then raise exception 'trial payment guard missing'; end if;
 execute replace(definition,marker,'((c.quote->>''amount_minor'')::bigint is distinct from 0 and not platform_private.has_verified_discount_payment(p_order_id))');
 end loop;
 definition:=pg_get_functiondef('platform_private.fulfill_zero_discount_checkout(uuid)'::regprocedure);
 definition:=replace(definition,'platform_private.confirm_zero_trial_replacement','platform_private.confirm_trial_checkout_replacement');
 definition:=replace(definition,'platform_private.schedule_zero_period_after_trial','platform_private.schedule_confirmed_period_after_trial');
 execute definition;
 definition:=pg_get_functiondef('platform_private.fulfill_discount_payment(uuid)'::regprocedure);
 marker:='if c.quote ? ''trial_purchase'' or s.trial_access_id is not null or s.status=''trial'' then';
 if position(marker in definition)=0 then raise exception 'paid trial guard missing'; end if;
 definition:=replace(definition,marker,'if (s.trial_access_id is not null or s.status=''trial'') and coalesce(c.quote#>>''{trial_purchase,transition}'','''') not in (''after_trial'',''replace_trial_on_payment'') then');
 marker:='result:=public.confirm_organization_subscription_period(c.organization_id,c.id,o.expected_revision,o.plan_version_id,o.period_start,o.period_end);';
 if position(marker in definition)=0 then raise exception 'paid trial confirmation missing'; end if;
 definition:=replace(definition,marker,'if c.quote#>>''{trial_purchase,transition}''=''after_trial'' then
 result:=platform_private.schedule_confirmed_period_after_trial(c.id);
 elsif c.quote#>>''{trial_purchase,transition}''=''replace_trial_on_payment'' then
 result:=platform_private.confirm_trial_checkout_replacement(c.id);
 else '||marker||' end if;');
 execute definition;
end; $$;
commit;
