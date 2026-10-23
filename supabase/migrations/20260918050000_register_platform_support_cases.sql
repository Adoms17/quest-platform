begin;
-- Только техническая привязка обращения, без переписки и персональных данных.
create table public.platform_support_cases (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 closed_at timestamptz,
 unique(id,organization_id)
);
alter table public.platform_support_cases enable row level security;
revoke all on public.platform_support_cases from public,anon,authenticated,service_role;
alter table public.platform_access_assignments add constraint platform_support_case_scope_fk
 foreign key(support_case_id,organization_id) references public.platform_support_cases(id,organization_id) on delete restrict;

create table public.platform_support_commands (
 actor_id uuid not null references auth.users(id), command_id uuid not null,
 request jsonb not null, case_id uuid not null references public.platform_support_cases(id),
 created_at timestamptz not null default clock_timestamp(), primary key(actor_id,command_id)
);
alter table public.platform_support_commands enable row level security;
revoke all on public.platform_support_commands from public,anon,authenticated,service_role;
alter table public.platform_audit_events add column support_case_id uuid references public.platform_support_cases(id);
alter table public.platform_audit_events drop constraint platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check
 check(action in ('assignment.created','assignment.updated','organization.summary.read','assignment.grant','assignment.revoke','support.open','support.close'));

-- Идемпотентное открытие/закрытие владельцем; поддержка не выдаёт доступ сама себе.
create function public.manage_platform_support_case(p_command_id uuid,p_action text,p_target_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare req jsonb; prior public.platform_support_commands%rowtype; target public.platform_support_cases%rowtype;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_action is null or p_action not in ('open','close') or p_target_id is null then
  raise exception 'invalid support command' using errcode='22023';
 end if;
 req:=jsonb_build_object('action',p_action,'target_id',p_target_id);
 select * into prior from public.platform_support_commands where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.request<>req then raise exception 'platform command conflict' using errcode='22023'; end if;
  return prior.case_id;
 end if;
 if p_action='open' then
  insert into public.platform_support_cases(organization_id,created_by) values(p_target_id,auth.uid()) returning * into target;
 else
  select * into target from public.platform_support_cases where id=p_target_id for update;
  if not found then raise exception 'support case unavailable' using errcode='22023'; end if;
  update public.platform_support_cases set closed_at=coalesce(closed_at,clock_timestamp()) where id=target.id;
 end if;
 insert into public.platform_support_commands(actor_id,command_id,request,case_id) values(auth.uid(),p_command_id,req,target.id);
 insert into public.platform_audit_events(actor_id,organization_id,action,command_id,support_case_id)
 values(auth.uid(),target.organization_id,'support.'||p_action,p_command_id,target.id);
 return target.id;
end; $$;

create function public.grant_platform_support_access(p_command_id uuid,p_case_id uuid,p_user_id uuid,p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare req jsonb; prior public.platform_assignment_commands%rowtype; target public.platform_support_cases%rowtype; result uuid;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_case_id is null or p_user_id is null or p_expires_at is null or not isfinite(p_expires_at) then
  raise exception 'invalid support assignment' using errcode='22023';
 end if;
 req:=jsonb_build_object('action','grant','case_id',p_case_id,'user_id',p_user_id,'expires_at',p_expires_at);
 select * into prior from public.platform_assignment_commands where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.request<>req then raise exception 'platform command conflict' using errcode='22023'; end if;
  return prior.assignment_id;
 end if;
 select * into target from public.platform_support_cases where id=p_case_id for update;
 if not found or target.closed_at is not null then raise exception 'support case unavailable' using errcode='22023'; end if;
 if p_expires_at<=clock_timestamp() then raise exception 'invalid support assignment' using errcode='22023'; end if;
 insert into public.platform_access_assignments(user_id,role_key,scope_kind,organization_id,support_case_id,expires_at)
 values(p_user_id,'support','support_case',target.organization_id,target.id,p_expires_at) returning id into result;
 insert into public.platform_assignment_commands(actor_id,command_id,request,assignment_id) values(auth.uid(),p_command_id,req,result);
 return result;
end; $$;

create or replace function public.require_platform_permission(p_permission text,p_organization_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare selected_id uuid;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'platform access denied' using errcode='42501'; end if;
 select a.id into selected_id from public.platform_access_assignments a
 join public.platform_role_permissions p on p.role_key=a.role_key and p.permission_key=p_permission
 where a.user_id=auth.uid() and a.revoked_at is null
 and a.valid_from<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp())
 and p_organization_id is not null and (a.scope_kind='platform' or a.organization_id=p_organization_id)
 and (a.scope_kind<>'support_case' or exists(select 1 from public.platform_support_cases c
   where c.id=a.support_case_id and c.organization_id=a.organization_id and c.closed_at is null))
 order by a.id limit 1;
 if selected_id is null then raise exception 'platform access denied' using errcode='42501'; end if;
 return selected_id;
end; $$;
revoke all on function public.manage_platform_support_case(uuid,text,uuid),public.grant_platform_support_access(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.manage_platform_support_case(uuid,text,uuid),public.grant_platform_support_access(uuid,uuid,uuid,timestamptz) to authenticated;
commit;
