begin;
-- В sandbox выдача подписки только явно включённым тестовым организациям.
create table public.billing_sandbox_application_scope (
 organization_id uuid primary key references public.organizations(id) on delete restrict
);
create table public.billing_sandbox_events (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.billing_sandbox_orders(id) on delete restrict,
 payment_id uuid not null,
 event_type text not null check(event_type in ('payment.succeeded','payment.canceled','payment.waiting_for_capture','reconciliation')),
 received_at timestamptz not null default clock_timestamp(),
 processed_at timestamptz,
 unique(order_id,payment_id,event_type)
);
create table public.billing_sandbox_fulfillments (
 order_id uuid primary key references public.billing_sandbox_orders(id) on delete restrict,
 state text not null check(state in ('not_paid','applied','deferred','review')),
 reason text,
 checked_at timestamptz not null default clock_timestamp()
);
create table public.billing_sandbox_reconciliation_jobs (
 order_id uuid primary key references public.billing_sandbox_orders(id) on delete restrict,
 next_check_at timestamptz not null default clock_timestamp(),
 lease_until timestamptz,
 attempts integer not null default 0,
 last_error text
);
alter table public.billing_sandbox_application_scope enable row level security;
alter table public.billing_sandbox_events enable row level security;
alter table public.billing_sandbox_fulfillments enable row level security;
alter table public.billing_sandbox_reconciliation_jobs enable row level security;
revoke all on public.billing_sandbox_application_scope,public.billing_sandbox_events,public.billing_sandbox_fulfillments,public.billing_sandbox_reconciliation_jobs from public,anon,authenticated,service_role;

-- Разделить доверенную запись и пользовательский шлюз: webhook не зависит
-- от того, остался ли инициатор оплаты сотрудником организации.
alter function public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text) rename to record_sandbox_payment_result_internal;
revoke all on function public.record_sandbox_payment_result_internal(uuid,uuid,text,boolean,boolean,text) from public,anon,authenticated,service_role;
do $$declare d text; needle text:='if not found or auth.uid() is null or not public.has_organization_permission(o.organization_id,''billing.manage'') then'; begin
 d:=pg_get_functiondef('public.record_sandbox_payment_result_internal(uuid,uuid,text,boolean,boolean,text)'::regprocedure);
 if position(needle in d)=0 then raise exception 'sandbox result authorization marker missing'; end if;
 execute replace(d,needle,'if not found then');
end;$$;
create function public.record_sandbox_payment_result(p_order_id uuid,p_payment_id uuid,p_status text,p_paid boolean,p_test boolean,p_confirmation_url text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select organization_id into org from public.billing_sandbox_orders where id=p_order_id for update;
 if auth.uid() is null or org is null or not public.has_organization_permission(org,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 return public.record_sandbox_payment_result_internal(p_order_id,p_payment_id,p_status,p_paid,p_test,p_confirmation_url);
end;$$;
revoke all on function public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text) to service_role;

create function public.read_sandbox_reconciliation_order(p_shop_id text,p_order_id uuid default null,p_payment_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; r public.billing_sandbox_payment_results%rowtype;
begin
 select b.* into o from public.billing_sandbox_orders b
 left join public.billing_sandbox_payment_results pr on pr.order_id=b.id
 where b.shop_id=p_shop_id and b.first_sent_at is not null
 and (p_order_id is not null and b.id=p_order_id or p_order_id is null and pr.payment_id=p_payment_id);
 if not found then return null; end if;
 select * into r from public.billing_sandbox_payment_results where order_id=o.id;
 if p_payment_id is not null and r.payment_id is not null and r.payment_id<>p_payment_id then return null; end if;
 return jsonb_build_object('id',o.id,'organizationId',o.organization_id,'planVersionId',o.plan_version_id,
 'environment','sandbox','shopId',o.shop_id,'returnUrl',o.return_url,'amountMinor',o.amount_minor,'currency',o.currency,
 'idempotencyKey',o.idempotency_key,'firstSentAt',o.first_sent_at,'providerPaymentId',r.payment_id);
end;$$;

create function public.enqueue_sandbox_payment_event(p_shop_id text,p_order_id uuid,p_payment_id uuid,p_event_type text)
returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
 if p_payment_id is null or p_event_type is null or p_event_type not in ('payment.succeeded','payment.canceled','payment.waiting_for_capture','reconciliation') then raise exception 'invalid sandbox event' using errcode='22023'; end if;
 if public.read_sandbox_reconciliation_order(p_shop_id,p_order_id,p_payment_id) is null then raise exception 'sandbox order unavailable' using errcode='42501'; end if;
 -- Только идентификаторы, ни raw webhook, ни реквизиты карты, ни контакты.
 insert into public.billing_sandbox_events(order_id,payment_id,event_type) values(p_order_id,p_payment_id,p_event_type)
 on conflict(order_id,payment_id,event_type) do nothing returning id into event_id;
 if event_id is null then select id into event_id from public.billing_sandbox_events where order_id=p_order_id and payment_id=p_payment_id and event_type=p_event_type; end if;
 insert into public.billing_sandbox_reconciliation_jobs(order_id) values(p_order_id) on conflict(order_id) do nothing;
 return event_id;
end;$$;

create function public.apply_sandbox_payment_event(p_event_id uuid,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_sandbox_events%rowtype; o public.billing_sandbox_orders%rowtype; r jsonb; outcome jsonb; v_state text; v_reason text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'sandbox requires read committed' using errcode='40001'; end if;
 select * into e from public.billing_sandbox_events where id=p_event_id;
 if not found then raise exception 'sandbox event missing' using errcode='22023'; end if;
 select * into o from public.billing_sandbox_orders where id=e.order_id;
 -- Порядок: confirmation advisory → подписка → заказ → событие.
 perform pg_advisory_xact_lock(hashtextextended(o.id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=o.organization_id for update;
 select * into o from public.billing_sandbox_orders where id=e.order_id for update;
 select * into e from public.billing_sandbox_events where id=p_event_id for update;
 if (p_payment->>'paymentId')::uuid is distinct from e.payment_id then raise exception 'sandbox event payment mismatch' using errcode='22023'; end if;
 r:=public.record_sandbox_payment_result_internal(o.id,e.payment_id,p_payment->>'status',(p_payment->>'paid')::boolean,(p_payment->>'test')::boolean,p_payment->>'confirmationUrl');
 if (r->>'requires_review')::boolean then v_state:='review';v_reason:='payment_conflict';
 elsif r->>'status'='succeeded' then
  if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id) then
   v_state:='review';v_reason:='sandbox_scope_disabled';
  else
   perform public.enqueue_billing_confirmation(o.organization_id,o.id,o.expected_revision,o.plan_version_id,o.period_start,o.period_end);
   outcome:=public.process_billing_confirmation(o.id);
   v_state:=outcome->>'state';v_reason:=outcome->>'reason';
  end if;
 else v_state:='not_paid'; end if;
 insert into public.billing_sandbox_fulfillments(order_id,state,reason) values(o.id,v_state,v_reason)
 on conflict(order_id) do update set state=excluded.state,reason=excluded.reason,checked_at=clock_timestamp();
 if v_state='applied' then update public.billing_sandbox_orders set state='finished' where id=o.id; end if;
 update public.billing_sandbox_events set processed_at=clock_timestamp() where order_id=o.id and payment_id=e.payment_id;
 return jsonb_build_object('orderId',o.id,'paymentStatus',r->>'status','fulfillmentState',v_state,'reason',v_reason);
end;$$;

create function public.claim_sandbox_reconciliation(p_shop_id text,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>10 then raise exception 'invalid sandbox batch' using errcode='22023'; end if;
 insert into public.billing_sandbox_reconciliation_jobs(order_id)
 select id from public.billing_sandbox_orders where shop_id=p_shop_id and first_sent_at is not null and state<>'finished'
 on conflict(order_id) do nothing;
 with candidates as (
  select j.order_id from public.billing_sandbox_reconciliation_jobs j join public.billing_sandbox_orders o on o.id=j.order_id
  where o.shop_id=p_shop_id and j.next_check_at<=clock_timestamp() and (j.lease_until is null or j.lease_until<=clock_timestamp())
  and (o.state<>'finished' or exists(select 1 from public.billing_sandbox_events e where e.order_id=o.id and e.processed_at is null))
  order by j.next_check_at,j.order_id limit p_limit for update of j skip locked
 ), claimed as (
  update public.billing_sandbox_reconciliation_jobs j set lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1
  from candidates c where c.order_id=j.order_id returning j.order_id
 ) select coalesce(jsonb_agg(order_id),'[]'::jsonb) into result from claimed;
 return result;
end;$$;
create function public.finish_sandbox_reconciliation(p_order_id uuid,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_error is not null and p_error not in ('provider_unavailable','payment_not_found','verification_failed') then raise exception 'invalid sandbox outcome' using errcode='22023'; end if;
 update public.billing_sandbox_reconciliation_jobs set lease_until=null,next_check_at=clock_timestamp()+interval '5 minutes',last_error=p_error where order_id=p_order_id;
end;$$;
revoke all on function public.read_sandbox_reconciliation_order(text,uuid,uuid),public.enqueue_sandbox_payment_event(text,uuid,uuid,text),public.apply_sandbox_payment_event(uuid,jsonb),public.claim_sandbox_reconciliation(text,integer),public.finish_sandbox_reconciliation(uuid,text) from public,anon,authenticated;
grant execute on function public.read_sandbox_reconciliation_order(text,uuid,uuid),public.enqueue_sandbox_payment_event(text,uuid,uuid,text),public.apply_sandbox_payment_event(uuid,jsonb),public.claim_sandbox_reconciliation(text,integer),public.finish_sandbox_reconciliation(uuid,text) to service_role;

-- Deferred-подтверждение тоже обязано заново проверить sandbox-доказательство,
-- даже если его обрабатывает общий lifecycle, а не платёжный worker.
alter function public.process_billing_confirmation(uuid) rename to process_billing_confirmation_before_sandbox;
revoke all on function public.process_billing_confirmation_before_sandbox(uuid) from public,anon,authenticated,service_role;
create function public.process_billing_confirmation(p_confirmation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; r public.billing_sandbox_payment_results%rowtype; v_reason text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text,7350));
 select * into o from public.billing_sandbox_orders where id=p_confirmation_id;
 if found and not exists(select 1 from public.billing_period_confirmations where confirmation_id=p_confirmation_id) then
  select * into r from public.billing_sandbox_payment_results where order_id=o.id;
  if r.order_id is null or r.status<>'succeeded' or not r.paid or r.requires_review then v_reason:='sandbox_payment_unverified';
  elsif not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id) then v_reason:='sandbox_scope_disabled'; end if;
  if v_reason is not null then
   update public.billing_confirmation_inbox set state='review',reason=v_reason,checked_at=clock_timestamp() where confirmation_id=p_confirmation_id;
   return jsonb_build_object('confirmation_id',p_confirmation_id,'state','review','reason',v_reason);
  end if;
 end if;
 return public.process_billing_confirmation_before_sandbox(p_confirmation_id);
end;$$;
revoke all on function public.process_billing_confirmation(uuid) from public,anon,authenticated;
grant execute on function public.process_billing_confirmation(uuid) to service_role;
commit;
