begin;
create function public.accept_sandbox_discount_checkout(p_organization_id uuid,p_offer_id uuid,p_command_id uuid,p_code text,p_reviewed_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then raise exception 'sandbox organization required' using errcode='42501'; end if;
 return platform_private.accept_reviewed_discount_checkout(p_organization_id,p_offer_id,p_command_id,p_code,p_reviewed_quote);
end; $$;
revoke all on function public.accept_sandbox_discount_checkout(uuid,uuid,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.accept_sandbox_discount_checkout(uuid,uuid,uuid,text,jsonb) to authenticated;
create function public.execute_sandbox_discount_checkout(p_organization_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_discount_checkouts%rowtype; result jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then raise exception 'sandbox organization required' using errcode='42501'; end if;
 select * into c from public.billing_discount_checkouts where id=p_order_id and organization_id=p_organization_id;
 if not found then raise exception 'discount checkout unavailable' using errcode='42501'; end if;
 if (c.quote->>'amount_minor')::bigint=0 then
 result:=platform_private.fulfill_zero_discount_checkout(c.id);
 return jsonb_build_object('order_id',c.id,'requires_payment',false,'fulfillment',result);
 end if;
 perform platform_private.prepare_discount_payment(c.id);
 -- Только подготовка: провайдер вызывается существующим отдельным Edge-путём.
 return jsonb_build_object('order_id',c.id,'requires_payment',true,'payment_order_id',c.id);
end; $$;
revoke all on function public.execute_sandbox_discount_checkout(uuid,uuid) from public,anon,service_role;
grant execute on function public.execute_sandbox_discount_checkout(uuid,uuid) to authenticated;
commit;
