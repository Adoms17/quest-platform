begin;
-- Каталог платформы: только назначения в области platform. Контекстные роли позже.
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read'));
insert into public.platform_role_permissions values ('owner','billing.catalog.read'),('operations','billing.catalog.read'),('sales','billing.catalog.read');
create table public.platform_tariff_read_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id) on delete restrict,
 plan_version_id uuid references public.billing_plan_versions(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_tariff_read_events enable row level security;
revoke all on public.platform_tariff_read_events from public,anon,authenticated,service_role;
revoke all on sequence public.platform_tariff_read_events_id_seq from public,anon,authenticated,service_role;
create function public.read_platform_tariff_catalog(p_after uuid default null,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' or not exists(
 select 1 from public.platform_access_assignments a join public.platform_role_permissions p on p.role_key=a.role_key
 where a.user_id=auth.uid() and a.scope_kind='platform' and p.permission_key='billing.catalog.read'
 and a.revoked_at is null and a.valid_from<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp())) then
 raise exception 'platform access denied' using errcode='42501'; end if;
 if p_id is not null and p_after is not null then raise exception 'invalid catalog cursor' using errcode='22023'; end if;
 with candidates as (
 select id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at
 from public.billing_plan_versions where (p_id is null or id=p_id) and (p_after is null or id>p_after)
 order by id limit 26
 ), numbered as (select *,row_number() over(order by id) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by id) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by id))[25] else null end) into result from numbered;
 insert into public.platform_tariff_read_events(actor_id,plan_version_id)
 values(auth.uid(),case when exists(select 1 from public.billing_plan_versions where id=p_id) then p_id else null end);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.catalog.read','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.read_platform_tariff_catalog(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_tariff_catalog(uuid,uuid) to authenticated;
commit;
