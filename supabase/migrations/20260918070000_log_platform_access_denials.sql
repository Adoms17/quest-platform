begin;
-- RAISE LOG не откатывается вместе с отклонённой транзакцией.
-- Доставка/срок хранения журналов на целевой среде проверяются отдельно.
create function platform_private.log_access_denial(p_action text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_action not in ('organization.search','organization.summary.read','assignment.grant','assignment.revoke','support.manage','support.grant') then
  raise exception 'invalid denial action' using errcode='22023';
 end if;
 raise log 'QVESTA_ADMIN_DENIAL %', jsonb_build_object(
  'version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),
  'action',p_action,'sqlstate','42501','occurred_at',clock_timestamp());
end; $$;
revoke all on function platform_private.log_access_denial(text) from public,anon,authenticated,service_role;

-- Сохраняем внешний контракт и исходную проверку прав.
alter function public.search_platform_organizations(text,uuid,integer) set schema platform_private;
revoke all on function platform_private.search_platform_organizations(text,uuid,integer) from public,anon,authenticated,service_role;
create function public.search_platform_organizations(p_search text default '',p_after uuid default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return platform_private.search_platform_organizations(p_search,p_after,p_limit);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('organization.search');
 raise;
end; $$;
revoke all on function public.search_platform_organizations(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_platform_organizations(text,uuid,integer) to authenticated;

-- Сохраняем внешний контракт и исходную проверку прав.
alter function public.get_platform_organization_summary(uuid) set schema platform_private;
revoke all on function platform_private.get_platform_organization_summary(uuid) from public,anon,authenticated,service_role;
create function public.get_platform_organization_summary(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return platform_private.get_platform_organization_summary(p_organization_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('organization.summary.read');
 raise;
end; $$;
revoke all on function public.get_platform_organization_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_platform_organization_summary(uuid) to authenticated;

-- Сохраняем внешний контракт и исходную проверку прав.
alter function public.grant_platform_assignment(uuid,uuid,text,uuid) set schema platform_private;
revoke all on function platform_private.grant_platform_assignment(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.grant_platform_assignment(p_command_id uuid,p_user_id uuid,p_role text,p_organization_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return platform_private.grant_platform_assignment(p_command_id,p_user_id,p_role,p_organization_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('assignment.grant');
 raise;
end; $$;
revoke all on function public.grant_platform_assignment(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.grant_platform_assignment(uuid,uuid,text,uuid) to authenticated;

-- Сохраняем внешний контракт и исходную проверку прав.
alter function public.revoke_platform_assignment(uuid,uuid) set schema platform_private;
revoke all on function platform_private.revoke_platform_assignment(uuid,uuid) from public,anon,authenticated,service_role;
create function public.revoke_platform_assignment(p_command_id uuid,p_assignment_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return platform_private.revoke_platform_assignment(p_command_id,p_assignment_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('assignment.revoke');
 raise;
end; $$;
revoke all on function public.revoke_platform_assignment(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.revoke_platform_assignment(uuid,uuid) to authenticated;

-- Сохраняем внешний контракт и исходную проверку прав.
alter function public.manage_platform_support_case(uuid,text,uuid) set schema platform_private;
revoke all on function platform_private.manage_platform_support_case(uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.manage_platform_support_case(p_command_id uuid,p_action text,p_target_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return platform_private.manage_platform_support_case(p_command_id,p_action,p_target_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('support.manage');
 raise;
end; $$;
revoke all on function public.manage_platform_support_case(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.manage_platform_support_case(uuid,text,uuid) to authenticated;

-- Сохраняем внешний контракт и исходную проверку прав.
alter function public.grant_platform_support_access(uuid,uuid,uuid,timestamptz) set schema platform_private;
revoke all on function platform_private.grant_platform_support_access(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
create function public.grant_platform_support_access(p_command_id uuid,p_case_id uuid,p_user_id uuid,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return platform_private.grant_platform_support_access(p_command_id,p_case_id,p_user_id,p_expires_at);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('support.grant');
 raise;
end; $$;
revoke all on function public.grant_platform_support_access(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.grant_platform_support_access(uuid,uuid,uuid,timestamptz) to authenticated;
commit;
