begin;
-- Неэкспонируемая схема, без доступа API-ролей и без SECURITY DEFINER.
create schema platform_private;
revoke all on schema platform_private from public,anon,authenticated,service_role;
create table platform_private.owner_bootstrap (
 singleton boolean primary key default true check(singleton),
 command_id uuid not null,
 user_id uuid not null references auth.users(id) on delete restrict,
 assignment_id uuid not null references public.platform_access_assignments(id) on delete restrict,
 database_operator text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table platform_private.owner_bootstrap enable row level security;
revoke all on platform_private.owner_bootstrap from public,anon,authenticated,service_role;

-- Вызывается оператором БД после отдельного подтверждения личности владельца.
-- Не выбирает пользователя по email и не назначает права при миграции.
create function platform_private.bootstrap_owner(p_command_id uuid,p_user_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare prior platform_private.owner_bootstrap%rowtype; result uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'platform commands require read committed' using errcode='40001';
 end if;
 if p_command_id is null or p_user_id is null then
  raise exception 'invalid platform bootstrap' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(18092026,1);
 select * into prior from platform_private.owner_bootstrap where singleton;
 if found then
  if prior.command_id<>p_command_id or prior.user_id<>p_user_id then
   raise exception 'platform bootstrap already completed' using errcode='23514';
  end if;
  -- Исторический receipt, не восстановление отозванного назначения.
  return prior.assignment_id;
 end if;
 if exists(select 1 from public.platform_access_assignments where role_key='owner') then
  raise exception 'platform owner already exists' using errcode='23514';
 end if;
 if not exists(select 1 from auth.users where id=p_user_id) then
  raise exception 'platform bootstrap account unavailable' using errcode='22023';
 end if;
 insert into public.platform_access_assignments(user_id,role_key,scope_kind)
 values(p_user_id,'owner','platform') returning id into result;
 insert into platform_private.owner_bootstrap(command_id,user_id,assignment_id,database_operator)
 values(p_command_id,p_user_id,result,session_user);
 return result;
end; $$;
revoke all on function platform_private.bootstrap_owner(uuid,uuid) from public,anon,authenticated,service_role;
commit;
