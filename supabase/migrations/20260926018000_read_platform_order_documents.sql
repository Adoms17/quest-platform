begin;
create function public.read_platform_order_documents(p_organization_id uuid,p_payment_order_id uuid,p_document_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; receipt public.checkout_document_acceptances; result jsonb;
begin
 assignment:=public.require_platform_permission('billing.payment.read',p_organization_id);
 if not exists(select 1 from public.billing_sandbox_orders where id=p_payment_order_id and organization_id=p_organization_id) then
  raise exception 'order unavailable' using errcode='42501'; end if;
 select a.* into receipt from public.checkout_document_acceptances a
 join public.billing_discount_checkouts c on c.id=a.order_id and c.organization_id=a.organization_id
 join public.billing_discount_payment_links l on l.checkout_id=c.id
 where l.payment_order_id=p_payment_order_id and a.organization_id=p_organization_id;
 if found then
  if p_document_id is not null and p_document_id not in (receipt.agreement_id,receipt.payment_terms_id) then
   raise exception 'document unavailable' using errcode='42501'; end if;
  select jsonb_build_object('accepted_at',receipt.accepted_at,'checkout_id',receipt.order_id,'documents',
   jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'sha256',d.sha256,'effective_at',d.effective_at) order by d.kind),
   'document',case when p_document_id is null then null else
    (select jsonb_build_object('id',id,'kind',kind,'body',body,'sha256',sha256) from public.purchase_document_versions where id=p_document_id) end)
   into result from public.purchase_document_versions d where d.id in (receipt.agreement_id,receipt.payment_terms_id);
 elsif p_document_id is not null then raise exception 'document unavailable' using errcode='42501';
 end if;
 insert into public.platform_payment_read_events(actor_id,assignment_id,organization_id) values(auth.uid(),assignment,p_organization_id);
 return result;
end; $$;
revoke all on function public.read_platform_order_documents(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_order_documents(uuid,uuid,text) to authenticated;
commit;
