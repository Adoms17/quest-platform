begin;
-- Запись результата платежа доступна только доверенному backend после проверки
-- ответа ЮKassa (сумма, валюта, магазин, metadata, test). Клиентского RPC нет.
create function platform_private.fulfill_discount_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; o public.billing_sandbox_orders%rowtype;
 payment public.billing_sandbox_payment_results%rowtype; s public.organization_subscriptions%rowtype; result jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into c from public.billing_discount_checkouts where id=p_order_id;
 if not found then raise exception 'discount checkout unavailable' using errcode='22023'; end if;
 select * into s from public.organization_subscriptions where organization_id=c.organization_id for update;
 select b.* into o from public.billing_sandbox_orders b join public.billing_discount_payment_links l on l.payment_order_id=b.id where l.checkout_id=c.id for update of b;
 select * into payment from public.billing_sandbox_payment_results where order_id=o.id;
 if o.id is null or o.organization_id<>c.organization_id or o.amount_minor is distinct from (c.quote->>'amount_minor')::bigint
 or o.amount_minor<=0 or o.currency<>'RUB' or o.first_sent_at is null
 or payment.order_id is null or payment.shop_id<>o.shop_id or payment.status<>'succeeded' or not payment.paid or payment.requires_review
 or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=c.organization_id) then
 raise exception 'discount payment unverified' using errcode='55000'; end if;
 select f.result into result from public.billing_discount_fulfillments f where order_id=c.id;
 if found then return result; end if;
 if c.quote ? 'trial_purchase' or s.trial_access_id is not null or s.status='trial' then
 raise exception 'paid trial fulfillment pending' using errcode='55000'; end if;
 perform platform_private.begin_discount_checkout_execution(c.id);
 result:=public.confirm_organization_subscription_period(c.organization_id,c.id,o.expected_revision,o.plan_version_id,o.period_start,o.period_end);
 perform platform_private.settle_discount_period(c.id,true);
 result:=result||jsonb_build_object('order_id',c.id,'status','completed','amount_minor',o.amount_minor,'payment_required',true);
 insert into public.billing_discount_fulfillments(order_id,result) values(c.id,result);
 update public.billing_discount_checkout_states set state='completed',changed_at=clock_timestamp() where order_id=c.id;
 update public.billing_sandbox_orders set state='finished' where id=o.id;
 return result;
end; $$;
revoke all on function platform_private.fulfill_discount_payment(uuid) from public,anon,authenticated,service_role;
create function platform_private.process_discount_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform platform_private.fulfill_discount_payment(p_order_id);
 return jsonb_build_object('confirmation_id',p_order_id,'state','applied','reason',null);
exception when sqlstate '40001' or sqlstate '22023' or sqlstate '55000' or sqlstate 'P0001' then
 -- Внешняя транзакция сохранит доказательство оплаты. Частичная выдача/расход
 -- откатятся в этом блоке, а сверка сможет безопасно повторить исполнение.
 return jsonb_build_object('confirmation_id',p_order_id,'state','review','reason','discount_reconciliation_required');
end; $$;
revoke all on function platform_private.process_discount_payment(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.apply_sandbox_payment_event(uuid,jsonb)'::regprocedure);
 marker:='v_state:=''review'';v_reason:=''discount_fulfillment_pending'';';
 if position(marker in definition)=0 then raise exception 'discount event guard missing'; end if;
 execute replace(definition,marker,'outcome:=platform_private.process_discount_payment(o.id); v_state:=outcome->>''state'';v_reason:=outcome->>''reason'';');
 definition:=pg_get_functiondef('public.process_billing_confirmation(uuid)'::regprocedure);
 marker:='return jsonb_build_object(''confirmation_id'',p_confirmation_id,''state'',''review'',''reason'',''discount_fulfillment_pending'');';
 if position(marker in definition)=0 then raise exception 'discount runner guard missing'; end if;
 execute replace(definition,marker,'return platform_private.process_discount_payment(p_confirmation_id);');
end; $$;
commit;
