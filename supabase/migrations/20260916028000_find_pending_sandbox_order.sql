-- Восстановление текущего заказа на новом устройстве без запуска платежа.
begin;
create function public.find_pending_sandbox_order(p_organization_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 select id into result from public.billing_sandbox_orders
 where organization_id=p_organization_id and state<>'finished';
 return result;
end;$$;
revoke all on function public.find_pending_sandbox_order(uuid) from public,anon;
grant execute on function public.find_pending_sandbox_order(uuid) to authenticated;
commit;
