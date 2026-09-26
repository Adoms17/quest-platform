begin;
create table public.checkout_document_acceptances (
 order_id uuid primary key references public.billing_discount_checkouts(id),
 actor_id uuid not null,
 organization_id uuid not null,
 agreement_id text not null references public.purchase_document_versions(id),
 payment_terms_id text not null references public.purchase_document_versions(id),
 accepted_at timestamptz not null default clock_timestamp()
);
alter table public.checkout_document_acceptances enable row level security;
revoke all on public.checkout_document_acceptances from public,anon,authenticated,service_role;
create trigger immutable_checkout_document_acceptance before update or delete on public.checkout_document_acceptances
 for each row execute function platform_private.guard_purchase_document_audit();
create function platform_private.record_checkout_documents(p_order_id uuid,p_agreement_id text,p_payment_terms_id text,p_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkout public.billing_discount_checkouts; saved public.checkout_document_acceptances;
 expected_agreement text; expected_payment text; accepted_time timestamptz;
begin
 if auth.uid() is null then raise exception 'checkout access denied' using errcode='42501'; end if;
 select * into checkout from public.billing_discount_checkouts where id=p_order_id for update;
 if not found or checkout.actor_id<>auth.uid() or not public.has_organization_permission(checkout.organization_id,'billing.manage') then
  raise exception 'checkout access denied' using errcode='42501'; end if;
 if p_accepted is distinct from true or p_agreement_id is null or p_payment_terms_id is null then
  raise exception 'documents not accepted' using errcode='22023'; end if;
 select * into saved from public.checkout_document_acceptances where order_id=p_order_id;
 if found then
  if saved.agreement_id is distinct from p_agreement_id or saved.payment_terms_id is distinct from p_payment_terms_id then
   raise exception 'checkout acceptance conflict' using errcode='22023'; end if;
  return to_jsonb(saved);
 end if;
 -- Serialize the selected registry snapshot with concurrent publication.
 lock table public.purchase_document_versions in share mode;
 accepted_time:=clock_timestamp();
 select id into expected_agreement from public.purchase_document_versions where kind='agreement' and status='published'
 and effective_at<=accepted_time order by effective_at desc limit 1;
 select id into expected_payment from public.purchase_document_versions where kind='payment_terms' and status='published'
 and effective_at<=accepted_time order by effective_at desc limit 1;
 if expected_agreement is null or expected_payment is null or p_agreement_id<>expected_agreement or p_payment_terms_id<>expected_payment then
  raise exception 'purchase documents changed' using errcode='40001'; end if;
 insert into public.checkout_document_acceptances(order_id,actor_id,organization_id,agreement_id,payment_terms_id,accepted_at)
 values(checkout.id,auth.uid(),checkout.organization_id,p_agreement_id,p_payment_terms_id,accepted_time) returning * into saved;
 return to_jsonb(saved);
end; $$;
revoke all on function platform_private.record_checkout_documents(uuid,text,text,boolean) from public,anon,authenticated,service_role;
commit;
