begin;
-- Частный исполнитель только для подтверждённого нулевого заказа другого тарифа.
create function platform_private.confirm_zero_trial_replacement(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; o public.billing_sandbox_offers%rowtype;
 s public.organization_subscriptions%rowtype; g public.billing_trial_access%rowtype;
 terms jsonb; previous jsonb; result jsonb; started timestamptz; ending timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into c from public.billing_discount_checkouts where id=p_order_id;
 if not found or (c.quote->>'amount_minor')::bigint is distinct from 0 then raise exception 'zero trial checkout required' using errcode='55000'; end if;
 select * into o from public.billing_sandbox_offers where id=c.offer_id;
 select * into s from public.organization_subscriptions where organization_id=c.organization_id for update;
 terms:=c.quote->'trial_purchase';
 if terms->>'transition' is distinct from 'replace_trial_on_payment' then raise exception 'trial replacement required' using errcode='55000'; end if;
 if s.revision is distinct from o.expected_revision or s.revision is distinct from (terms->>'subscription_revision')::bigint then
 raise exception 'billing revision conflict' using errcode='40001'; end if;
 select * into g from public.billing_trial_access where id=s.trial_access_id for update;
 started:=clock_timestamp();
 if g.id is null or g.id is distinct from (terms->>'access_id')::uuid
 or g.generation is distinct from (terms->>'generation')::integer
 or g.state not in ('scheduled','active') or g.access_kind<>'trial'
 or not public.trial_access_matches(s,g) or started<g.starts_at or started>=g.ends_at
 or g.ends_at is distinct from (terms->>'trial_ends_at')::timestamptz then
 raise exception 'trial checkout context changed' using errcode='40001'; end if;
 if o.period_months is null or o.valid_until<=started
 or o.plan_version_id is distinct from (terms->>'target_plan_version_id')::uuid
 or (select plan_key from public.billing_plan_versions where id=o.plan_version_id)
 is not distinct from (select plan_key from public.billing_plan_versions where id=g.plan_version_id) then
 raise exception 'invalid trial replacement target' using errcode='22023'; end if;
 ending:=((started at time zone 'Europe/Moscow')+make_interval(months=>o.period_months)) at time zone 'Europe/Moscow';
 previous:=to_jsonb(s);
 update public.organization_subscriptions set status='active',plan_version_id=o.plan_version_id,
 period_start=started,period_end=ending,trial_access_id=null where organization_id=c.organization_id returning * into s;
 update public.billing_trial_access set state='finished',was_started=true where id=g.id;
 insert into public.billing_trial_transitions(access_id,kind,generation,before_state,after_state)
 values(g.id,'finished',g.generation,previous,to_jsonb(s));
 result:=jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,'confirmation_id',p_order_id,
 'period_start',started,'period_end',ending,'trial_remaining_preserved',false);
 insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
 values(p_order_id,c.organization_id,jsonb_build_object('organization_id',c.organization_id,'revision',o.expected_revision,
 'plan',o.plan_version_id,'start',started,'end',ending,'source','zero_trial_replacement'),previous,result);
 return result;
end; $$;
revoke all on function platform_private.confirm_zero_trial_replacement(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('platform_private.fulfill_zero_discount_checkout(uuid)'::regprocedure);
 old:='if subscription.trial_access_id is not null or subscription.status=''trial'' then';
 if position(old in definition)=0 then raise exception 'trial guard marker missing'; end if;
 definition:=replace(definition,old,'if (subscription.trial_access_id is not null or subscription.status=''trial'') and checkout.quote#>>''{trial_purchase,transition}'' is distinct from ''replace_trial_on_payment'' then');
 old:='result:=public.confirm_organization_subscription_period(checkout.organization_id,p_order_id,offer.expected_revision,
 offer.plan_version_id,offer.period_start,offer.period_end);';
 if position(old in definition)=0 then raise exception 'trial confirmation marker missing'; end if;
 definition:=replace(definition,old,'if checkout.quote#>>''{trial_purchase,transition}''=''replace_trial_on_payment'' then
 result:=platform_private.confirm_zero_trial_replacement(p_order_id);
 else '||old||' end if;');
 execute definition;
end; $$;
commit;
