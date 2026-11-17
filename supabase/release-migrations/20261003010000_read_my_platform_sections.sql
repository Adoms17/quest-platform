begin;
-- UI navigation only. Every operation must still enforce its own permission and MFA.
create function public.read_my_platform_sections() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then
  raise exception 'platform access denied' using errcode='42501';
 end if;
 with eligible as (
  select a.* from public.platform_access_assignments a
  where a.user_id=auth.uid() and a.revoked_at is null
   and a.valid_from<=statement_timestamp()
   and (a.expires_at is null or a.expires_at>statement_timestamp())
   and (a.scope_kind<>'support_case' or exists (
    select 1 from public.platform_support_cases c where c.id=a.support_case_id
     and c.organization_id=a.organization_id and c.closed_at is null))
 ), sections as (
  select 'organizations' as key from eligible a join public.platform_role_permissions p
   on p.role_key=a.role_key and p.permission_key='organization.summary.read'
  union
  select 'tariffs' from eligible a join public.platform_role_permissions p
   on p.role_key=a.role_key and p.permission_key='billing.catalog.read' where a.scope_kind='platform'
  union
  select 'campaigns' from eligible a join public.platform_role_permissions p
   on p.role_key=a.role_key and p.permission_key='billing.campaign.draft' where a.scope_kind='platform'
  union
  select 'statistics' from eligible a join public.platform_role_permissions p
   on p.role_key=a.role_key and p.permission_key='organization.statistics.read' where a.scope_kind='platform'
  union
  select unnest(array['documents','fiscal-acceptance','fiscal-policy']) from eligible a
   where a.role_key='owner' and a.scope_kind='platform' and a.expires_at is null
 ) select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into result from sections;
 return result;
end; $$;
revoke all on function public.read_my_platform_sections() from public,anon,authenticated,service_role;
grant execute on function public.read_my_platform_sections() to authenticated;
commit;
