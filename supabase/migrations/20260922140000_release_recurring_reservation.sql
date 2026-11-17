begin;
-- Освобождаем только резерв, который ещё не связан с отправкой или выдачей доступа.
create function platform_private.release_unsent_recurring_reservations(p_consent_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
 for item in select r.id from public.billing_recurring_orders r join public.billing_discount_reservations d on d.order_id=r.id
 where r.consent_id=p_consent_id and d.state='reserved' order by r.id
 loop
  if exists(select 1 from public.billing_sandbox_orders where id=item.id)
  or exists(select 1 from public.billing_period_confirmations where confirmation_id=item.id) then continue; end if;
  perform platform_private.settle_discount_period(item.id,false);
 end loop;
end; $$;
revoke all on function platform_private.release_unsent_recurring_reservations(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.revoke_sandbox_recurring_consent(uuid,uuid)'::regprocedure);
 marker:='return ''revoked'';';
 if position(marker in definition)=0 then raise exception 'recurring revoke marker missing'; end if;
 execute replace(definition,marker,'perform platform_private.release_unsent_recurring_reservations(c.id); '||marker);
 definition:=pg_get_functiondef('platform_private.prepare_recurring_order(uuid,timestamptz,bigint)'::regprocedure);
 marker:='return old.quote;';
 if position(marker in definition)=0 then raise exception 'recurring retry marker missing'; end if;
 execute replace(definition,marker,'if exists(select 1 from public.billing_discount_reservations where order_id=old.id and state=''released'') then raise exception ''recurring reservation released'' using errcode=''55000''; end if; '||marker);
end; $$;
commit;
