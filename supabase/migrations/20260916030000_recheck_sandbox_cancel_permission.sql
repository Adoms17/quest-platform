begin;
create or replace function public.cancel_unsent_sandbox_order(p_organization_id uuid,p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'sandbox requires read committed' using errcode='40001'; end if;
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if o.id is null then raise exception 'sandbox order unavailable' using errcode='42501'; end if;
 if o.first_sent_at is not null then raise exception 'sandbox payment requires reconciliation' using errcode='22023'; end if;
 update public.billing_sandbox_orders set state='finished' where id=o.id;
end;$$;
commit;
