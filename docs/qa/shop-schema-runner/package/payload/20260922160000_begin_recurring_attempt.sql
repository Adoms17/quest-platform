begin;
create table public.billing_recurring_attempts (
 order_id uuid primary key references public.billing_recurring_orders(id),
 idempotency_key uuid not null unique default gen_random_uuid(),
 provider_method_id text not null,
 shop_id text not null check(shop_id ~ '^[0-9]+$'),
 amount_minor bigint not null check(amount_minor>0),
 currency text not null check(currency='RUB'),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.billing_recurring_attempts enable row level security;
revoke all on public.billing_recurring_attempts from public,anon,authenticated,service_role;
create trigger recurring_attempt_immutable before update or delete or truncate on public.billing_recurring_attempts for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.begin_recurring_attempt(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; checked jsonb; attempt public.billing_recurring_attempts%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then raise exception 'recurring order unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into attempt from public.billing_recurring_attempts where order_id=r.id;
 if found then return jsonb_build_object('state','reconciliation_required','idempotency_key',attempt.idempotency_key); end if;
 checked:=platform_private.review_recurring_order(r.id);
 if checked->>'state'<>'ready' then return checked; end if;
 if (checked->>'requires_payment')::boolean is distinct from true then return jsonb_build_object('state','zero_amount'); end if;
 insert into public.billing_recurring_attempts(order_id,provider_method_id,shop_id,amount_minor,currency)
 select r.id,m.provider_method_id,o.shop_id,(r.quote->>'amount_minor')::bigint,'RUB'
 from public.billing_recurring_methods m join public.billing_sandbox_orders o on o.id=r.source_order_id
 where m.consent_id=r.consent_id returning * into attempt;
 if not found then raise exception 'recurring method unavailable' using errcode='55000'; end if;
 return jsonb_build_object('state','prepared','idempotency_key',attempt.idempotency_key);
end; $$;
revoke all on function platform_private.begin_recurring_attempt(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='if exists(select 1 from public.billing_sandbox_orders where id=';
begin
 definition:=pg_get_functiondef('platform_private.review_recurring_order(uuid)'::regprocedure);
 if position(marker||'r.id)' in definition)=0 then raise exception 'review attempt marker missing'; end if;
 execute replace(definition,marker||'r.id)', 'if exists(select 1 from public.billing_recurring_attempts where order_id=r.id) or exists(select 1 from public.billing_sandbox_orders where id=r.id)');
 definition:=pg_get_functiondef('platform_private.release_unsent_recurring_reservations(uuid)'::regprocedure);
 if position(marker||'item.id)' in definition)=0 then raise exception 'release attempt marker missing'; end if;
 execute replace(definition,marker||'item.id)', 'if exists(select 1 from public.billing_recurring_attempts where order_id=item.id) or exists(select 1 from public.billing_sandbox_orders where id=item.id)');
end; $$;
commit;
