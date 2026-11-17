begin;
-- Восстановление по сохранённому ID команды, без повторной передачи промокода.
create function public.recover_sandbox_discount_checkout(p_organization_id uuid,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; result jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if p_command_id is null then raise exception 'command required' using errcode='22023'; end if;
 select * into c from public.billing_discount_checkouts where actor_id=auth.uid() and command_id=p_command_id and organization_id=p_organization_id;
 if not found then return null; end if;
 select platform_private.discount_quote_review_fields(c.quote)||jsonb_build_object(
 'order_id',c.id,'state',s.state,'reservation_state',r.state,
 'payment_order_id',l.payment_order_id,'payment_status',p.status,
 'payment_requires_review',coalesce(p.requires_review,false),
 'fulfillment',f.result)
 into result from public.billing_discount_checkout_states s
 join public.billing_discount_reservations r on r.order_id=s.order_id
 left join public.billing_discount_payment_links l on l.checkout_id=s.order_id
 left join public.billing_sandbox_payment_results p on p.order_id=l.payment_order_id
 left join public.billing_discount_fulfillments f on f.order_id=s.order_id
 where s.order_id=c.id;
 return result;
end; $$;
revoke all on function public.recover_sandbox_discount_checkout(uuid,uuid) from public,anon,service_role;
grant execute on function public.recover_sandbox_discount_checkout(uuid,uuid) to authenticated;
create function public.cancel_sandbox_discount_checkout(p_organization_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if not exists(select 1 from public.billing_discount_checkouts where id=p_order_id and organization_id=p_organization_id) then
 raise exception 'discount checkout unavailable' using errcode='42501'; end if;
 -- Тот же порядок блокировок, что у подготовки/выдачи денежного заказа.
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if exists(select 1 from public.billing_discount_payment_links where checkout_id=p_order_id) then
 return platform_private.cancel_discount_payment(p_order_id,true);
 end if;
 return platform_private.cancel_discount_checkout(p_organization_id,p_order_id);
end; $$;
revoke all on function public.cancel_sandbox_discount_checkout(uuid,uuid) from public,anon,service_role;
grant execute on function public.cancel_sandbox_discount_checkout(uuid,uuid) to authenticated;
commit;
