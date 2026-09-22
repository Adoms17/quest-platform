begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read','billing.campaign.draft','billing.campaign.issue','billing.payment.read','billing.refund.preview'));
insert into public.platform_role_permissions values ('owner','billing.refund.preview'),('sales','billing.refund.preview');
create table public.platform_refund_preview_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 assignment_id uuid not null references public.platform_access_assignments(id),
 organization_id uuid not null references public.organizations(id),
 order_id uuid not null references public.billing_sandbox_orders(id),
 amount_minor bigint not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_refund_preview_events enable row level security;
revoke all on public.platform_refund_preview_events from public,anon,authenticated,service_role;
revoke all on sequence public.platform_refund_preview_events_id_seq from public,anon,authenticated,service_role;
create function public.preview_platform_sandbox_refund(p_organization_id uuid,p_order_id uuid,p_amount_minor bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; o public.billing_sandbox_orders%rowtype; r public.billing_sandbox_payment_results%rowtype; used bigint; available bigint; requested bigint;
begin
 assignment:=public.require_platform_permission('billing.refund.preview',p_organization_id);
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not found or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then
  raise exception 'sandbox refund scope denied' using errcode='42501';
 end if;
 select * into r from public.billing_sandbox_payment_results where order_id=o.id;
 if r.order_id is null or r.status<>'succeeded' or not r.paid or r.requires_review then
  raise exception 'sandbox payment not refundable' using errcode='22023';
 end if;
 -- Как в preview_sandbox_refund, все незавершённые возвраты удерживают сумму.
 select coalesce(sum(amount_minor),0) into used from public.billing_sandbox_refunds where order_id=o.id and state not in ('canceled','rejected');
 available:=greatest(o.amount_minor-used,0);
 requested:=coalesce(p_amount_minor,available);
 if requested<=0 or requested>available then raise exception 'invalid refund amount' using errcode='22023'; end if;
 insert into public.platform_refund_preview_events(actor_id,assignment_id,organization_id,order_id,amount_minor)
 values(auth.uid(),assignment,p_organization_id,o.id,requested);
 return jsonb_build_object('order_id',o.id,'payment_id',r.payment_id,'amount_minor',o.amount_minor,
 'available_minor',available,'requested_minor',requested,'currency',o.currency,'environment','sandbox','access_effect','unchanged');
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.refund.preview','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.preview_platform_sandbox_refund(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.preview_platform_sandbox_refund(uuid,uuid,bigint) to authenticated;
commit;
