begin;
-- Closed until UI and execution guards are released together. Existing sandbox API is unchanged.
create function platform_private.accept_checkout_with_documents(
 p_organization_id uuid,p_offer_id uuid,p_command_id uuid,p_code text,p_reviewed_quote jsonb,
 p_agreement_id text,p_payment_terms_id text,p_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; receipt jsonb; prior_id uuid;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if p_accepted is distinct from true or p_agreement_id is null or p_payment_terms_id is null then
 raise exception 'documents not accepted' using errcode='22023'; end if;
 if p_command_id is null then raise exception 'command required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':discount-checkout:'||p_command_id::text,0));
 select id into prior_id from public.billing_discount_checkouts where actor_id=auth.uid() and command_id=p_command_id;
 if prior_id is not null and not exists(select 1 from public.checkout_document_acceptances where order_id=prior_id) then
 raise exception 'legacy checkout requires separate handling' using errcode='22023'; end if;
 result:=platform_private.accept_reviewed_discount_checkout(p_organization_id,p_offer_id,p_command_id,p_code,p_reviewed_quote);
 if (result->>'ok')::boolean is distinct from true then return result; end if;
 receipt:=platform_private.record_checkout_documents((result->>'order_id')::uuid,p_agreement_id,p_payment_terms_id,p_accepted);
 return result||jsonb_build_object('document_acceptance',receipt);
 -- No exception swallowing: any acceptance error rolls back checkout and discount reservation.
end; $$;
revoke all on function platform_private.accept_checkout_with_documents(uuid,uuid,uuid,text,jsonb,text,text,boolean) from public,anon,authenticated,service_role;
commit;
