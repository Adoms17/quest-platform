begin;
-- Проверенная оплата будущего non-trial периода ожидает штатной сверки.
-- Не создаём receipt и не расходуем скидку до фактической выдачи.
create function platform_private.defer_future_discount_payment(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.organization_subscriptions%rowtype; c public.billing_discount_checkouts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into c from public.billing_discount_checkouts where id=p_order_id;
 if not found or c.quote ? 'trial_purchase' then return false; end if;
 select * into s from public.organization_subscriptions where organization_id=c.organization_id for update;
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found or clock_timestamp()>=o.period_start
 or exists(select 1 from public.billing_discount_fulfillments where order_id=p_order_id) then return false; end if;
 if not platform_private.has_verified_discount_payment(p_order_id) then raise exception 'discount payment unverified' using errcode='55000'; end if;
 if s.revision is distinct from o.expected_revision or s.status<>'active' or s.trial_access_id is not null
 or s.period_end is distinct from o.period_start or o.period_end<=o.period_start then
 raise exception 'future discount subscription conflict' using errcode='40001'; end if;
 perform platform_private.begin_discount_checkout_execution(p_order_id);
 -- Очередь sandbox сверяет сохранённый платёж, не создавая новую оплату.
 insert into public.billing_sandbox_reconciliation_jobs(order_id) values(p_order_id) on conflict do nothing;
 return true;
end; $$;
revoke all on function platform_private.defer_future_discount_payment(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='perform platform_private.fulfill_discount_payment(p_order_id);';
begin
 definition:=pg_get_functiondef('platform_private.process_discount_payment(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'discount processing marker missing'; end if;
 execute replace(definition,marker,'if platform_private.defer_future_discount_payment(p_order_id) then
 return jsonb_build_object(''confirmation_id'',p_order_id,''state'',''deferred'',''reason'',''future_period''); end if; '||marker);
end; $$;
commit;