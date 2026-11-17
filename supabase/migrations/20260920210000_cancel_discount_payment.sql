begin;
-- p_before_send: пользовательская отмена до отправки; иначе только проверенная
-- окончательная отмена провайдера. Таймаут сам по себе резерв не освобождает.
create function platform_private.cancel_discount_payment(p_order_id uuid,p_before_send boolean)
returns text language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; o public.billing_sandbox_orders%rowtype;
 payment public.billing_sandbox_payment_results%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_before_send is null then raise exception 'invalid cancellation mode' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 select * into c from public.billing_discount_checkouts where id=p_order_id;
 if not found then raise exception 'discount checkout unavailable' using errcode='22023'; end if;
 perform 1 from public.organization_subscriptions where organization_id=c.organization_id for update;
 select b.* into o from public.billing_sandbox_orders b join public.billing_discount_payment_links l on l.payment_order_id=b.id where l.checkout_id=c.id for update of b;
 if not found then raise exception 'discount payment link missing' using errcode='22023'; end if;
 select * into payment from public.billing_sandbox_payment_results where order_id=o.id;
 if p_before_send then
 if auth.uid() is null or not public.has_organization_permission(c.organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if o.first_sent_at is not null or payment.order_id is not null then raise exception 'discount payment requires reconciliation' using errcode='55000'; end if;
 else
 if o.first_sent_at is null or payment.order_id is null or payment.shop_id<>o.shop_id
 or payment.status<>'canceled' or payment.paid or payment.requires_review then
 raise exception 'discount cancellation unverified' using errcode='55000'; end if;
 end if;
 if exists(select 1 from public.billing_discount_fulfillments where order_id=c.id) then
 raise exception 'fulfilled discount checkout cannot be canceled' using errcode='55000'; end if;
 perform platform_private.settle_discount_period(c.id,false);
 update public.billing_discount_checkout_states set state='cancelled',changed_at=clock_timestamp() where order_id=c.id and state<>'cancelled';
 update public.billing_sandbox_orders set state='finished' where id=o.id and state<>'finished';
 return 'cancelled';
end; $$;
revoke all on function platform_private.cancel_discount_payment(uuid,boolean) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('platform_private.process_discount_payment(uuid)'::regprocedure);
 marker:='perform platform_private.fulfill_discount_payment(p_order_id);';
 if position(marker in definition)=0 then raise exception 'discount processing marker missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.billing_sandbox_payment_results where order_id=p_order_id and status=''canceled'') then
 perform platform_private.cancel_discount_payment(p_order_id,false);
 return jsonb_build_object(''confirmation_id'',p_order_id,''state'',''not_paid'',''reason'',''discount_payment_canceled''); end if; '||marker);
 definition:=pg_get_functiondef('public.apply_sandbox_payment_event(uuid,jsonb)'::regprocedure);
 marker:='elsif r->>''status''=''succeeded'' and exists(select 1 from public.billing_discount_payment_links where payment_order_id=o.id) then';
 if position(marker in definition)=0 then raise exception 'discount cancellation event marker missing'; end if;
 execute replace(definition,marker,'elsif r->>''status'' in (''succeeded'',''canceled'') and exists(select 1 from public.billing_discount_payment_links where payment_order_id=o.id) then');
end; $$;
commit;
