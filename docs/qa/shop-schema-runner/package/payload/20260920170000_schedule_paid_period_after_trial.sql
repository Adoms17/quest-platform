begin;
create table public.billing_trial_paid_periods (
 order_id uuid primary key references public.billing_discount_checkouts(id),
 access_id uuid not null unique references public.billing_trial_access(id),
 organization_id uuid not null references public.organizations(id),
 generation integer not null,
 plan_version_id uuid not null references public.billing_plan_versions(id),
 period_start timestamptz not null, period_end timestamptz not null check(period_end>period_start),
 confirmed_at timestamptz not null default clock_timestamp()
);
alter table public.billing_trial_paid_periods enable row level security;
revoke all on public.billing_trial_paid_periods from public,anon,authenticated,service_role;
create trigger trial_paid_terms_immutable before update or delete or truncate on public.billing_trial_paid_periods
 for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.schedule_zero_period_after_trial(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; o public.billing_sandbox_offers%rowtype;
 s public.organization_subscriptions%rowtype; g public.billing_trial_access%rowtype; terms jsonb;
begin
 select * into c from public.billing_discount_checkouts where id=p_order_id;
 if not found or (c.quote->>'amount_minor')::bigint is distinct from 0 then raise exception 'zero trial checkout required' using errcode='55000'; end if;
 select * into o from public.billing_sandbox_offers where id=c.offer_id;
 select * into s from public.organization_subscriptions where organization_id=c.organization_id for update;
 terms:=c.quote->'trial_purchase';
 if terms->>'transition' is distinct from 'after_trial' then raise exception 'scheduled trial purchase required' using errcode='55000'; end if;
 if s.revision is distinct from o.expected_revision or s.revision is distinct from (terms->>'subscription_revision')::bigint then raise exception 'billing revision conflict' using errcode='40001'; end if;
 select * into g from public.billing_trial_access where id=s.trial_access_id for update;
 if g.id is null or g.id is distinct from (terms->>'access_id')::uuid
 or g.generation is distinct from (terms->>'generation')::integer or g.state not in ('scheduled','active')
 or not public.trial_access_matches(s,g) or clock_timestamp()<g.starts_at or clock_timestamp()>=g.ends_at
 or o.period_start is distinct from g.ends_at or o.period_start is distinct from (terms->>'trial_ends_at')::timestamptz then
 raise exception 'trial checkout context changed' using errcode='40001'; end if;
 if (select plan_key from public.billing_plan_versions where id=g.plan_version_id) is distinct from
 (select plan_key from public.billing_plan_versions where id=o.plan_version_id) then raise exception 'same trial plan required' using errcode='22023'; end if;
 insert into public.billing_trial_paid_periods(order_id,access_id,organization_id,generation,plan_version_id,period_start,period_end)
 values(p_order_id,g.id,s.organization_id,g.generation,o.plan_version_id,o.period_start,o.period_end);
 return jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,'confirmation_id',p_order_id,
 'period_start',o.period_start,'period_end',o.period_end,'access_state','scheduled','trial_remaining_preserved',true);
end; $$;
revoke all on function platform_private.schedule_zero_period_after_trial(uuid) from public,anon,authenticated,service_role;

-- Подтверждённый будущий период нельзя потерять из-за конкурирующей смены подписки.
create function platform_private.protect_paid_trial_binding() returns trigger language plpgsql security definer set search_path='' as $$
declare paid public.billing_trial_paid_periods%rowtype;
begin
 select * into paid from public.billing_trial_paid_periods where access_id=old.trial_access_id;
 if not found then return new; end if;
 if row(new.plan_version_id,new.period_start,new.period_end,new.trial_access_id,new.cancel_at_period_end,new.scheduled_plan_version_id,new.scheduled_effective_at)
 is not distinct from row(old.plan_version_id,old.period_start,old.period_end,old.trial_access_id,old.cancel_at_period_end,old.scheduled_plan_version_id,old.scheduled_effective_at)
 and new.status in ('trial','expired') then return new; end if;
 if clock_timestamp()>=paid.period_start and new.status='active' and new.plan_version_id=paid.plan_version_id
 and new.period_start=paid.period_start and new.period_end=paid.period_end and new.trial_access_id is null
 and not new.cancel_at_period_end and new.scheduled_plan_version_id is null and new.scheduled_effective_at is null then return new; end if;
 raise exception 'paid trial transition pending' using errcode='55000';
end; $$;
revoke all on function platform_private.protect_paid_trial_binding() from public,anon,authenticated,service_role;
create trigger a_paid_trial_binding before update on public.organization_subscriptions for each row execute function platform_private.protect_paid_trial_binding();

do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('platform_private.fulfill_zero_discount_checkout(uuid)'::regprocedure);
 marker:='checkout.quote#>>''{trial_purchase,transition}'' is distinct from ''replace_trial_on_payment''';
 if position(marker in definition)=0 then raise exception 'trial fulfillment guard missing'; end if;
 definition:=replace(definition,marker,'coalesce(checkout.quote#>>''{trial_purchase,transition}'','''') not in (''replace_trial_on_payment'',''after_trial'')');
 marker:='result:=platform_private.confirm_zero_trial_replacement(p_order_id);';
 definition:=replace(definition,marker,marker||' elsif checkout.quote#>>''{trial_purchase,transition}''=''after_trial'' then result:=platform_private.schedule_zero_period_after_trial(p_order_id);');
 execute definition;
 definition:=pg_get_functiondef('public.effective_trial_subscription(public.organization_subscriptions,timestamptz)'::regprocedure);
 marker:='declare g public.billing_trial_access%rowtype;';
 if position(marker in definition)=0 then raise exception 'effective trial declaration missing'; end if;
 definition:=replace(definition,marker,marker||' paid public.billing_trial_paid_periods%rowtype;');
 marker:='if p_at>=g.ends_at then';
 if position(marker in definition)=0 then raise exception 'effective trial boundary missing'; end if;
 definition:=replace(definition,marker,'select * into paid from public.billing_trial_paid_periods where access_id=g.id and generation=g.generation;
 if found and p_at>=paid.period_start then
 s.status:=''active''; s.plan_version_id:=paid.plan_version_id; s.period_start:=paid.period_start; s.period_end:=paid.period_end;
 s.cancel_at_period_end:=false; s.scheduled_plan_version_id:=null; s.scheduled_effective_at:=null; return s;
 end if; '||marker);
 execute definition;
 definition:=pg_get_functiondef('public.advance_organization_trial(uuid)'::regprocedure);
 marker:='if e.status=''free'' then outcome:=''finished'';';
 if position(marker in definition)=0 then raise exception 'trial runner boundary missing'; end if;
 execute replace(definition,marker,'if e.status in (''free'',''active'') then outcome:=''finished'';');
end; $$;
commit;
