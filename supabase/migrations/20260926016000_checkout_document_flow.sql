begin;
-- Opt-in test workspaces only. Empty by default; not a production payment switch.
create table public.checkout_document_scope(organization_id uuid primary key references public.organizations(id));
alter table public.checkout_document_scope enable row level security;
revoke all on public.checkout_document_scope from public,anon,authenticated,service_role;
create function public.accept_sandbox_checkout_documents(p_organization_id uuid,p_offer_id uuid,p_command_id uuid,p_code text,p_reviewed_quote jsonb,p_agreement_id text,p_payment_terms_id text,p_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.checkout_document_scope where organization_id=p_organization_id)
 or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then
 raise exception 'document checkout scope denied' using errcode='42501'; end if;
 begin
 return platform_private.accept_checkout_with_documents(p_organization_id,p_offer_id,p_command_id,p_code,p_reviewed_quote,p_agreement_id,p_payment_terms_id,p_accepted);
 exception when serialization_failure then return jsonb_build_object('ok',false,'reason','documents_changed'); end;
end; $$;
create function public.read_checkout_document_acceptance(p_organization_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 return (select to_jsonb(a) from public.checkout_document_acceptances a where order_id=p_order_id and organization_id=p_organization_id);
end; $$;
-- Preserve legacy behaviour outside explicitly selected workspaces.
alter function public.execute_sandbox_discount_checkout(uuid,uuid) rename to execute_sandbox_discount_checkout_without_documents;
revoke all on function public.execute_sandbox_discount_checkout_without_documents(uuid,uuid) from public,anon,authenticated,service_role;
create function public.execute_sandbox_discount_checkout(p_organization_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if exists(select 1 from public.checkout_document_scope where organization_id=p_organization_id)
 and not exists(select 1 from public.checkout_document_acceptances a where a.order_id=p_order_id and a.organization_id=p_organization_id) then
 raise exception 'documents not accepted' using errcode='42501'; end if;
 return public.execute_sandbox_discount_checkout_without_documents(p_organization_id,p_order_id);
end; $$;
revoke all on function public.accept_sandbox_checkout_documents(uuid,uuid,uuid,text,jsonb,text,text,boolean),public.read_checkout_document_acceptance(uuid,uuid),public.execute_sandbox_discount_checkout(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.accept_sandbox_checkout_documents(uuid,uuid,uuid,text,jsonb,text,text,boolean),public.read_checkout_document_acceptance(uuid,uuid),public.execute_sandbox_discount_checkout(uuid,uuid) to authenticated;
create function public.read_checkout_document_scope(p_organization_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 return exists(select 1 from public.checkout_document_scope where organization_id=p_organization_id);
end; $$;
revoke all on function public.read_checkout_document_scope(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_checkout_document_scope(uuid) to authenticated;
commit;
