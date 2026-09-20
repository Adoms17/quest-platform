begin;
create table public.billing_discount_payment_links (
 checkout_id uuid primary key references public.billing_discount_checkouts(id),
 payment_order_id uuid not null unique references public.billing_sandbox_orders(id),
 created_at timestamptz not null default clock_timestamp(),check(checkout_id=payment_order_id)
);
alter table public.billing_discount_payment_links enable row level security;
revoke all on public.billing_discount_payment_links from public,anon,authenticated,service_role;
create trigger discount_payment_link_immutable before update or delete or truncate on public.billing_discount_payment_links
 for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.prepare_discount_payment(p_checkout_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; o public.billing_sandbox_offers%rowtype;
 s public.organization_subscriptions%rowtype; linked uuid; amount bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_checkout_id::text,7350));
 select * into c from public.billing_discount_checkouts where id=p_checkout_id;
 if not found then raise exception 'discount checkout unavailable' using errcode='22023'; end if;
 select * into s from public.organization_subscriptions where organization_id=c.organization_id for update;
 select payment_order_id into linked from public.billing_discount_payment_links where checkout_id=c.id;
 if found then return linked; end if;
 amount:=(c.quote->>'amount_minor')::bigint;
 if amount is null or amount<=0 or (c.quote->>'requires_payment')::boolean is distinct from true then
 raise exception 'positive discount payment required' using errcode='22023'; end if;
 select * into o from public.billing_sandbox_offers where id=c.offer_id;
 if s.revision<>o.expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
 if o.valid_until<=clock_timestamp() or o.period_end<=clock_timestamp() then raise exception 'sandbox offer expired' using errcode='22023'; end if;
 perform platform_private.begin_discount_checkout_execution(c.id);
 insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,
 amount_minor,currency,shop_id,return_url,period_start,period_end,offer_id)
 values(c.id,c.organization_id,c.actor_id,c.id,o.plan_version_id,o.expected_revision,amount,'RUB',o.shop_id,o.return_url,o.period_start,o.period_end,o.id);
 insert into public.billing_discount_payment_links(checkout_id,payment_order_id) values(c.id,c.id);
 return c.id;
end; $$;
revoke all on function platform_private.prepare_discount_payment(uuid) from public,anon,authenticated,service_role;
-- До подключения нового исполнения никакой старый путь не выдаёт период
-- в обход скидки и сохранённых условий trial.
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.apply_sandbox_payment_event(uuid,jsonb)'::regprocedure);
 marker:='elsif r->>''status''=''succeeded'' then';
 if position(marker in definition)=0 then raise exception 'sandbox apply marker missing'; end if;
 execute replace(definition,marker,'elsif r->>''status''=''succeeded'' and exists(select 1 from public.billing_discount_payment_links where payment_order_id=o.id) then
 v_state:=''review'';v_reason:=''discount_fulfillment_pending'';
 '||marker);
 definition:=pg_get_functiondef('public.process_billing_confirmation(uuid)'::regprocedure);
 marker:='select * into o from public.billing_sandbox_orders where id=p_confirmation_id;';
 if position(marker in definition)=0 then raise exception 'sandbox confirmation marker missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.billing_discount_payment_links where payment_order_id=p_confirmation_id) then
 return jsonb_build_object(''confirmation_id'',p_confirmation_id,''state'',''review'',''reason'',''discount_fulfillment_pending''); end if; '||marker);
 definition:=pg_get_functiondef('public.cancel_unsent_sandbox_order(uuid,uuid)'::regprocedure);
 marker:='if o.first_sent_at is not null then';
 if position(marker in definition)=0 then raise exception 'sandbox cancel marker missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.billing_discount_payment_links where payment_order_id=o.id) then raise exception ''discount checkout requires reconciliation'' using errcode=''55000''; end if; '||marker);
end; $$;
commit;
