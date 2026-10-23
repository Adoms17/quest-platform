begin;
create table public.platform_assignment_commands (
 actor_id uuid not null references auth.users(id), command_id uuid not null,
 request jsonb not null, assignment_id uuid not null references public.platform_access_assignments(id),
 created_at timestamptz not null default clock_timestamp(), primary key(actor_id,command_id)
);
alter table public.platform_assignment_commands enable row level security;
revoke all on public.platform_assignment_commands from public,anon,authenticated,service_role;

-- Единая блокировка сериализует выдачу/отзыв и проверку последнего владельца.
create function public.require_platform_owner() returns void
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'platform commands require read committed' using errcode='40001';
 end if;
 perform pg_advisory_xact_lock(18092026,1);
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
 or not exists(select 1 from public.platform_access_assignments where user_id=auth.uid()
   and role_key='owner' and scope_kind='platform' and revoked_at is null
   and valid_from<=clock_timestamp() and expires_at is null) then
  raise exception 'platform owner required' using errcode='42501';
 end if;
end; $$;
revoke all on function public.require_platform_owner() from public,anon,authenticated,service_role;

create function public.grant_platform_assignment(p_command_id uuid,p_user_id uuid,p_role text,p_organization_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare req jsonb; prior public.platform_assignment_commands%rowtype; result uuid;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_user_id is null or p_role is null or p_role not in ('owner','operations','sales')
 or (p_role='owner' and p_organization_id is not null) then
  raise exception 'invalid platform assignment' using errcode='22023';
 end if;
 -- Поддержка требует реестра обращений; региональная роль — привязки регионов.
 req:=jsonb_build_object('action','grant','user_id',p_user_id,'role',p_role,'organization_id',p_organization_id);
 select * into prior from public.platform_assignment_commands where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.request<>req then raise exception 'platform command conflict' using errcode='22023'; end if;
  return prior.assignment_id;
 end if;
 insert into public.platform_access_assignments(user_id,role_key,scope_kind,organization_id)
 values(p_user_id,p_role,case when p_organization_id is null then 'platform' else 'organization' end,p_organization_id)
 returning id into result;
 insert into public.platform_assignment_commands values(auth.uid(),p_command_id,req,result,clock_timestamp());
 return result;
end; $$;

create function public.revoke_platform_assignment(p_command_id uuid,p_assignment_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare req jsonb; prior public.platform_assignment_commands%rowtype; target public.platform_access_assignments%rowtype;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_assignment_id is null then raise exception 'invalid platform assignment' using errcode='22023'; end if;
 req:=jsonb_build_object('action','revoke','assignment_id',p_assignment_id);
 select * into prior from public.platform_assignment_commands where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.request<>req then raise exception 'platform command conflict' using errcode='22023'; end if;
  return prior.assignment_id;
 end if;
 select * into target from public.platform_access_assignments where id=p_assignment_id for update;
 if not found then raise exception 'platform assignment unavailable' using errcode='22023'; end if;
 if target.revoked_at is null then
  if target.role_key='owner' and target.valid_from<=clock_timestamp() and not exists(
   select 1 from public.platform_access_assignments where id<>target.id and role_key='owner'
   and revoked_at is null and valid_from<=clock_timestamp() and expires_at is null
  ) then raise exception 'last platform owner protected' using errcode='23514'; end if;
  update public.platform_access_assignments set revoked_at=clock_timestamp() where id=target.id;
 end if;
 insert into public.platform_assignment_commands values(auth.uid(),p_command_id,req,target.id,clock_timestamp());
 return target.id;
end; $$;
revoke all on function public.grant_platform_assignment(uuid,uuid,text,uuid),public.revoke_platform_assignment(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.grant_platform_assignment(uuid,uuid,text,uuid),public.revoke_platform_assignment(uuid,uuid) to authenticated;
commit;
