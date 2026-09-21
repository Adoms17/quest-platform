begin;
create index platform_campaign_org_created_idx on public.platform_discount_campaigns(organization_id,created_at desc,id desc);
create table public.platform_campaign_read_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 assignment_id uuid not null references public.platform_access_assignments(id),
 organization_id uuid not null references public.organizations(id),
 campaign_id uuid references public.platform_discount_campaigns(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_campaign_read_events enable row level security;
revoke all on public.platform_campaign_read_events from public,anon,authenticated,service_role;
revoke all on sequence public.platform_campaign_read_events_id_seq from public,anon,authenticated,service_role;
create function public.read_platform_discount_campaigns(p_organization_id uuid,p_after uuid default null,p_id uuid default null,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; cursor_time timestamptz; result jsonb; actual_revision integer;
begin
 assignment:=public.require_platform_permission('billing.campaign.draft',p_organization_id);
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 if (p_id is not null and p_after is not null) or (p_expected_revision is not null and p_id is null) then raise exception 'invalid campaign query' using errcode='22023'; end if;
 if p_id is not null then
  select revision into actual_revision from public.platform_discount_campaigns where id=p_id and organization_id=p_organization_id for share;
  if not found then raise exception 'campaign unavailable' using errcode='22023'; end if;
  if p_expected_revision is not null and p_expected_revision<>actual_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 end if;
 if p_after is not null then
  select created_at into cursor_time from public.platform_discount_campaigns where id=p_after and organization_id=p_organization_id;
  if not found then raise exception 'invalid campaign cursor' using errcode='22023'; end if;
 end if;
 with candidates as (
  select id,organization_id,title,plan_key,discount_bps,eligible_periods,period_months,activate_before,revision,state,approved_at,created_at,updated_at,
   activate_before<=statement_timestamp() activation_expired
  from public.platform_discount_campaigns
  where organization_id=p_organization_id and (p_id is null or id=p_id)
   and (p_after is null or (created_at,id)<(cursor_time,p_after))
  order by created_at desc,id desc limit 26
 ), numbered as (select *,row_number() over(order by created_at desc,id desc) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(c)-'n' order by created_at desc,id desc) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by created_at desc,id desc))[25] else null end)
 into result from numbered c;
 insert into public.platform_campaign_read_events(actor_id,assignment_id,organization_id,campaign_id) values(auth.uid(),assignment,p_organization_id,p_id);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.campaign.draft','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.read_platform_discount_campaigns(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_discount_campaigns(uuid,uuid,uuid,integer) to authenticated;
commit;
