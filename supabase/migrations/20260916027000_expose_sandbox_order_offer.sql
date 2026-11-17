-- Предварительный просмотр сохранённых условий. Не создаёт заказ или платёж.
begin;
create or replace function public.get_sandbox_order_offer(p_organization_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; plan_name text;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id;
 if not found then raise exception 'sandbox order unavailable' using errcode='42501'; end if;
 select display_name into plan_name from public.billing_plan_versions where id=o.plan_version_id;
 return jsonb_build_object('order_id',o.id,'organization_id',o.organization_id,'environment','sandbox',
   'plan_version_id',o.plan_version_id,'plan_name',plan_name,'amount_minor',o.amount_minor,'currency',o.currency,
   'period_start',o.period_start,'period_end',o.period_end,'state',o.state);
end;$$;
revoke all on function public.get_sandbox_order_offer(uuid,uuid) from public,anon;
grant execute on function public.get_sandbox_order_offer(uuid,uuid) to authenticated;
commit;
