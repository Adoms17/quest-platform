begin;
create function public.read_sandbox_receipt_contact(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.billing_receipt_snapshots%rowtype;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id;
 if auth.uid() is null or o.id is null or o.actor_id is distinct from auth.uid()
  or public.has_organization_permission(o.organization_id,'billing.manage') is not true then
  raise exception 'receipt access denied' using errcode='42501'; end if;
 select * into s from public.billing_receipt_snapshots where order_id=o.id;
 return jsonb_build_object('prepared',s.order_id is not null,'email',s.email,'canPrepare',o.state='reserved' and o.first_sent_at is null);
end; $$;
revoke all on function public.read_sandbox_receipt_contact(uuid) from public,anon,service_role;
grant execute on function public.read_sandbox_receipt_contact(uuid) to authenticated;
commit;
