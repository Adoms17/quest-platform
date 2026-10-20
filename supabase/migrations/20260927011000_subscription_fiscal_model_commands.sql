begin;
-- Only manual subscription orders use this selector. Models outrank legacy
-- policies, so an old admin client cannot silently switch a modeled shop back.
create function public.select_subscription_fiscal_policy(p_shop_id text,p_at timestamptz)
returns uuid language sql stable set search_path='' as $$
 select p.id from public.billing_fiscal_policies p
 left join public.billing_fiscal_policy_models m on m.policy_id=p.id
 where p.environment='sandbox' and p.shop_id=p_shop_id and p.effective_at<=p_at
  and (m.policy_id is null or (m.product_kind='subscription' and m.model_version='subscription_access_v1'))
 order by (m.policy_id is not null) desc,p.effective_at desc limit 1;
$$;
revoke all on function public.select_subscription_fiscal_policy(text,timestamptz) from public,anon,authenticated,service_role;

create function public.create_sandbox_subscription_fiscal_policy(p_id uuid,p_shop_id text,p_effective_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_owner();
 perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:'||coalesce(p_shop_id,''),0));
 if exists(select 1 from public.billing_fiscal_policies where id=p_id)
  and not exists(select 1 from public.billing_fiscal_policy_models where policy_id=p_id) then
  raise exception 'fiscal policy command conflict' using errcode='22023';
 end if;
 result:=public.create_sandbox_fiscal_policy(p_id,p_shop_id,p_effective_at,1,'service','full_prepayment');
 if not exists(select 1 from public.billing_fiscal_policy_models where policy_id=p_id) then
  insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)
  values(p_id,'subscription','subscription_access_v1','ausn','period_end');
 end if;
 return result;
end; $$;
revoke all on function public.create_sandbox_subscription_fiscal_policy(uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.create_sandbox_subscription_fiscal_policy(uuid,text,timestamptz) to authenticated;

create or replace function public.prepare_receipt_snapshot() returns trigger language plpgsql set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; p public.billing_fiscal_policies%rowtype;
begin
 select * into o from public.billing_sandbox_orders where id=new.order_id for update;
 if not found then raise exception 'receipt order missing' using errcode='23503'; end if;
 if o.first_sent_at is not null or o.state<>'reserved' then
  raise exception 'receipt must precede payment send' using errcode='55000'; end if;
 new.prepared_at:=statement_timestamp();
 select * into p from public.billing_fiscal_policies where id=public.select_subscription_fiscal_policy(o.shop_id,new.prepared_at);
 if not found or p.id is distinct from new.policy_id then
  raise exception 'receipt policy unavailable' using errcode='22023'; end if;
 new.amount_minor:=o.amount_minor; new.currency:=o.currency;
 new.vat_code:=p.vat_code; new.payment_subject:=p.payment_subject; new.payment_mode:=p.payment_mode;
 return new;
end; $$;
revoke all on function public.prepare_receipt_snapshot() from public,anon,authenticated,service_role;

create or replace function public.prepare_sandbox_receipt(p_order_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.billing_receipt_snapshots%rowtype;
 actor uuid:=auth.uid(); policy uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'receipt requires read committed' using errcode='40001'; end if;
 if actor is null then raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id;
 if not found or o.actor_id is distinct from actor or public.has_organization_permission(o.organization_id,'billing.manage') is not true then
  raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if o.actor_id is distinct from actor or public.has_organization_permission(o.organization_id,'billing.manage') is not true then
  raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into s from public.billing_receipt_snapshots where order_id=p_order_id;
 if found then
  if s.email is distinct from p_email then raise exception 'receipt command conflict' using errcode='22023'; end if;
  return to_jsonb(s);
 end if;
 if p_email is null or length(p_email)>254 or p_email<>btrim(p_email)
  or p_email ~ '[[:space:][:cntrl:]]' or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then
  raise exception 'invalid receipt email' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:'||o.shop_id,0));
 policy:=public.select_subscription_fiscal_policy(o.shop_id,statement_timestamp());
 if policy is null then raise exception 'receipt policy unavailable' using errcode='22023'; end if;
 insert into public.billing_receipt_snapshots(order_id,policy_id,email,description)
 values(o.id,policy,p_email,'Квеста: подписка '||to_char(o.period_start at time zone 'UTC','YYYY-MM-DD HH24:MI')||' — '||to_char(o.period_end at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC')
 returning * into s;
 insert into public.billing_receipt_audit(order_id,actor_id,event) values(o.id,actor,'snapshot_prepared');
 return to_jsonb(s);
end; $$;
revoke all on function public.prepare_sandbox_receipt(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_sandbox_receipt(uuid,text) to authenticated;

create function public.attach_subscription_fiscal_terms() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.billing_fiscal_policy_models where policy_id=new.policy_id) then
  insert into public.billing_subscription_fiscal_terms(order_id,policy_id) values(new.order_id,new.policy_id);
 end if;
 return new;
end; $$;
revoke all on function public.attach_subscription_fiscal_terms() from public,anon,authenticated,service_role;
create trigger receipt_subscription_terms_attach after insert on public.billing_receipt_snapshots
 for each row execute function public.attach_subscription_fiscal_terms();

create or replace function public.prepare_recurring_receipt(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; o public.billing_sandbox_orders%rowtype;
 s public.billing_recurring_receipt_snapshots%rowtype; source public.billing_receipt_snapshots%rowtype;
 policy public.billing_fiscal_policies%rowtype; amount bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'receipt requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then raise exception 'recurring order unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 select * into s from public.billing_recurring_receipt_snapshots where order_id=r.id;
 if found then return to_jsonb(s); end if;
 amount:=(r.quote->>'amount_minor')::bigint;
 if amount=0 then return jsonb_build_object('state','zero_amount'); end if;
 if amount is null or amount<1 or amount>9007199254740991 then raise exception 'invalid recurring receipt amount' using errcode='22023'; end if;
 if exists(select 1 from public.billing_recurring_attempts where order_id=r.id) then
  raise exception 'receipt must precede recurring attempt' using errcode='55000'; end if;
 select * into o from public.billing_sandbox_orders where id=r.source_order_id and organization_id=r.organization_id;
 if not found or o.plan_version_id is distinct from r.plan_version_id then
  raise exception 'recurring receipt source mismatch' using errcode='22023'; end if;
 if exists(select 1 from public.billing_recurring_revocations where consent_id=r.consent_id)
  or exists(select 1 from public.billing_recurring_cancellations where order_id=r.id) then
  raise exception 'recurring receipt unavailable' using errcode='55000'; end if;
 select * into source from public.billing_receipt_snapshots where order_id=o.id;
 if not found then raise exception 'recurring receipt contact unavailable' using errcode='55000'; end if;
 if exists(select 1 from public.billing_fiscal_policy_models where policy_id=source.policy_id) then
  raise exception 'subscription model recurring not supported' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:sandbox:'||o.shop_id,0));
 select * into policy from public.billing_fiscal_policies where environment='sandbox' and shop_id=o.shop_id and effective_at<=statement_timestamp() and not exists(select 1 from public.billing_fiscal_policy_models m where m.policy_id=billing_fiscal_policies.id)
 order by effective_at desc limit 1;
 if not found then raise exception 'receipt policy unavailable' using errcode='55000'; end if;
 insert into public.billing_recurring_receipt_snapshots(order_id,source_order_id,policy_id,email,description,amount_minor,currency,vat_code,payment_subject,payment_mode)
 values(r.id,o.id,policy.id,source.email,'Квеста: подписка '||to_char(r.period_start at time zone 'UTC','YYYY-MM-DD HH24:MI')||' — '||to_char(r.period_end at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC',amount,'RUB',policy.vat_code,policy.payment_subject,policy.payment_mode)
 returning * into s;
 return to_jsonb(s);
end; $$;
revoke all on function public.prepare_recurring_receipt(uuid) from public,anon,authenticated;
grant execute on function public.prepare_recurring_receipt(uuid) to service_role;

-- Current denotes the manual subscription selector, including model priority.
create or replace function public.list_sandbox_fiscal_policies(p_shop_id text,p_before timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_owner();
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or (p_before is not null and not isfinite(p_before)) then
  raise exception 'invalid fiscal policy query' using errcode='22023'; end if;
 with current_policy as (
  select public.select_subscription_fiscal_policy(p_shop_id,statement_timestamp()) as id
 ), page as (
  select id,shop_id,effective_at,vat_code,payment_subject,payment_mode,
   case when effective_at>statement_timestamp() then 'scheduled'
    when id=(select id from current_policy) then 'current' else 'superseded' end as display_status
  from public.billing_fiscal_policies where environment='sandbox' and shop_id=p_shop_id
   and (p_before is null or effective_at<p_before) order by effective_at desc limit 51
 ), visible as (select * from page order by effective_at desc limit 50)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by effective_at desc) from visible v),'[]'::jsonb),
  'next_cursor',case when (select count(*) from page)>50 then (select min(effective_at) from visible) else null end,
  'measured_at',statement_timestamp()) into result;
 return result;
end; $$;
revoke all on function public.list_sandbox_fiscal_policies(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.list_sandbox_fiscal_policies(text,timestamptz) to authenticated;

commit;
