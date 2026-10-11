begin;
create table public.billing_recurring_send_settings (
 order_id uuid primary key references public.billing_sandbox_orders(id),
 save_payment_method boolean not null
);
alter table public.billing_recurring_send_settings enable row level security;
revoke all on public.billing_recurring_send_settings from public,anon,authenticated,service_role;
create trigger recurring_send_immutable before update or delete or truncate on public.billing_recurring_send_settings for each statement execute function public.prevent_billing_plan_version_mutation();
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.begin_sandbox_payment_send(uuid)'::regprocedure);
 marker:='update public.billing_sandbox_orders set first_sent_at=coalesce(first_sent_at,measured)';
 if position(marker in definition)=0 then raise exception 'recurring send marker missing'; end if;
 definition:=replace(definition,marker,'insert into public.billing_recurring_send_settings(order_id,save_payment_method)
 values(o.id,o.first_sent_at is null and exists(select 1 from public.billing_recurring_consents c where c.order_id=o.id and not exists(select 1 from public.billing_recurring_revocations r where r.consent_id=c.id))) on conflict(order_id) do nothing; '||marker);
 marker:='''firstSentAt'',o.first_sent_at';
 if position(marker in definition)=0 then raise exception 'recurring payload marker missing'; end if;
 execute replace(definition,marker,marker||',''savePaymentMethod'',(select save_payment_method from public.billing_recurring_send_settings where order_id=o.id)');
 definition:=pg_get_functiondef('platform_private.bind_sandbox_recurring_method(uuid,jsonb)'::regprocedure);
 marker:='or exists(select 1 from public.billing_recurring_revocations where consent_id=c.id)';
 if position(marker in definition)=0 then raise exception 'recurring binding marker missing'; end if;
 execute replace(definition,marker,marker||' or not exists(select 1 from public.billing_recurring_send_settings where order_id=o.id and save_payment_method)');
end; $$;
create function public.read_sandbox_recurring_consent(p_organization_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; c public.billing_recurring_consents%rowtype; status text;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id;
 if not found then raise exception 'recurring order unavailable' using errcode='42501'; end if;
 select * into c from public.billing_recurring_consents where order_id=o.id;
 status:=case when c.id is null then 'none'
 when exists(select 1 from public.billing_recurring_revocations where consent_id=c.id) then 'revoked'
 when exists(select 1 from public.billing_recurring_methods where consent_id=c.id) then 'saved' else 'pending' end;
 return jsonb_build_object('state',status,'consent_id',c.id,'can_request',c.id is null and o.first_sent_at is null and o.state='reserved' and exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id));
end; $$;
revoke all on function public.read_sandbox_recurring_consent(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_sandbox_recurring_consent(uuid,uuid) to authenticated;
commit;
