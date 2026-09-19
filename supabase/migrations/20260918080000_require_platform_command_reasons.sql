begin;
create table public.platform_command_reasons (
 actor_id uuid not null references auth.users(id),
 command_id uuid not null,
 action text not null,
 reason_code text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,command_id),
 check (
  (action='assignment.grant' and reason_code in ('staff_onboarding','role_change')) or
  (action='assignment.revoke' and reason_code in ('staff_offboarding','security_response','role_change')) or
  (action in ('support.open','support.grant') and reason_code='support_request') or
  (action='support.close' and reason_code in ('request_resolved','request_cancelled'))
 )
);
alter table public.platform_command_reasons enable row level security;
revoke all on public.platform_command_reasons from public,anon,authenticated,service_role;
alter table public.platform_audit_events add column reason_code text;

create function platform_private.record_command_reason(p_command_id uuid,p_action text,p_reason_code text)
returns void language plpgsql security definer set search_path='' as $$
declare prior public.platform_command_reasons%rowtype;
begin
 -- Owner/MFA/общая блокировка проверяются вызывающей обёрткой раньше.
 if p_command_id is null then return; end if;
 if p_reason_code is null or p_action is null or not (
  (p_action='assignment.grant' and p_reason_code in ('staff_onboarding','role_change')) or
  (p_action='assignment.revoke' and p_reason_code in ('staff_offboarding','security_response','role_change')) or
  (p_action in ('support.open','support.grant') and p_reason_code='support_request') or
  (p_action='support.close' and p_reason_code in ('request_resolved','request_cancelled'))
 ) then raise exception 'invalid platform command reason' using errcode='22023'; end if;
 select * into prior from public.platform_command_reasons where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.action<>p_action or prior.reason_code<>p_reason_code then
   raise exception 'platform command conflict' using errcode='22023';
  end if;
  return;
 end if;
 if exists(select 1 from public.platform_assignment_commands where actor_id=auth.uid() and command_id=p_command_id)
 or exists(select 1 from public.platform_support_commands where actor_id=auth.uid() and command_id=p_command_id) then
  raise exception 'historical platform command reason unavailable' using errcode='22023';
 end if;
 insert into public.platform_command_reasons(actor_id,command_id,action,reason_code)
 values(auth.uid(),p_command_id,p_action,p_reason_code);
end; $$;
revoke all on function platform_private.record_command_reason(uuid,text,text) from public,anon,authenticated,service_role;

create function public.attach_platform_audit_reason() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.command_id is not null then
  select r.reason_code into new.reason_code from public.platform_command_reasons r
  where r.actor_id=new.actor_id and r.command_id=new.command_id;
 end if;
 return new;
end; $$;
revoke all on function public.attach_platform_audit_reason() from public,anon,authenticated,service_role;
create trigger platform_audit_reason before insert on public.platform_audit_events
 for each row execute function public.attach_platform_audit_reason();

drop function public.grant_platform_assignment(uuid,uuid,text,uuid);
create function public.grant_platform_assignment(p_command_id uuid,p_user_id uuid,p_role text,p_organization_id uuid default null,p_reason_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 perform platform_private.record_command_reason(p_command_id,'assignment.grant',p_reason_code);
 return platform_private.grant_platform_assignment(p_command_id,p_user_id,p_role,p_organization_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('assignment.grant');
 raise;
end; $$;
revoke all on function public.grant_platform_assignment(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.grant_platform_assignment(uuid,uuid,text,uuid,text) to authenticated;

drop function public.revoke_platform_assignment(uuid,uuid);
create function public.revoke_platform_assignment(p_command_id uuid,p_assignment_id uuid,p_reason_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 perform platform_private.record_command_reason(p_command_id,'assignment.revoke',p_reason_code);
 return platform_private.revoke_platform_assignment(p_command_id,p_assignment_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('assignment.revoke');
 raise;
end; $$;
revoke all on function public.revoke_platform_assignment(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.revoke_platform_assignment(uuid,uuid,text) to authenticated;

drop function public.manage_platform_support_case(uuid,text,uuid);
create function public.manage_platform_support_case(p_command_id uuid,p_action text,p_target_id uuid,p_reason_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 perform platform_private.record_command_reason(p_command_id,'support.'||p_action,p_reason_code);
 return platform_private.manage_platform_support_case(p_command_id,p_action,p_target_id);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('support.manage');
 raise;
end; $$;
revoke all on function public.manage_platform_support_case(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.manage_platform_support_case(uuid,text,uuid,text) to authenticated;

drop function public.grant_platform_support_access(uuid,uuid,uuid,timestamptz);
create function public.grant_platform_support_access(p_command_id uuid,p_case_id uuid,p_user_id uuid,p_expires_at timestamptz,p_reason_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 perform platform_private.record_command_reason(p_command_id,'support.grant',p_reason_code);
 return platform_private.grant_platform_support_access(p_command_id,p_case_id,p_user_id,p_expires_at);
exception when insufficient_privilege then
 perform platform_private.log_access_denial('support.grant');
 raise;
end; $$;
revoke all on function public.grant_platform_support_access(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.grant_platform_support_access(uuid,uuid,uuid,timestamptz,text) to authenticated;
commit;
