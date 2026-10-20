begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read'));
insert into public.platform_role_permissions values ('owner','billing.discount.read'),('sales','billing.discount.read');
create table public.platform_discount_read_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 assignment_id uuid not null references public.platform_access_assignments(id),
 organization_id uuid not null references public.organizations(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_discount_read_events enable row level security;
revoke all on public.platform_discount_read_events from public,anon,authenticated,service_role;
revoke all on sequence public.platform_discount_read_events_id_seq from public,anon,authenticated,service_role;
create index billing_discount_catalog_org_idx on public.billing_discount_codes(organization_id,created_at desc,id desc);
create index billing_discount_reservation_code_idx on public.billing_discount_reservations(discount_id,state);
create function public.read_platform_organization_discounts(p_organization_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; cursor_time timestamptz; result jsonb;
begin
 assignment:=public.require_platform_permission('billing.discount.read',p_organization_id);
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 if p_after is not null then
  select created_at into cursor_time from public.billing_discount_codes where id=p_after and organization_id=p_organization_id;
  if not found then raise exception 'invalid discount cursor' using errcode='22023'; end if;
 end if;
 with candidates as (
 select c.id,c.plan_key,c.discount_bps,c.eligible_periods,c.period_months,c.activate_before,c.created_at
 from public.billing_discount_codes c where c.organization_id=p_organization_id
 and (p_after is null or (c.created_at,c.id)<(cursor_time,p_after))
 order by c.created_at desc,c.id desc limit 26
 ), numbered as (select *,row_number() over(order by created_at desc,id desc) n from candidates),
 projected as (
 select n.*,usage.consumed_periods,usage.reserved_periods,
 greatest(0,n.eligible_periods-usage.consumed_periods-usage.reserved_periods) remaining_periods,
 n.activate_before<=statement_timestamp() activation_expired
 from numbered n cross join lateral (
 select count(*) filter(where state='consumed')::int consumed_periods,count(*) filter(where state='reserved')::int reserved_periods
 from public.billing_discount_reservations where discount_id=n.id
 ) usage
 )
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(p)-'n' order by created_at desc,id desc) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by created_at desc,id desc))[25] else null end)
 into result from projected p;
 insert into public.platform_discount_read_events(actor_id,assignment_id,organization_id) values(auth.uid(),assignment,p_organization_id);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.discount.read','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.read_platform_organization_discounts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_organization_discounts(uuid,uuid) to authenticated;
commit;