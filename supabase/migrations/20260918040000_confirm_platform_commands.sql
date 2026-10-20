begin;
-- Свежесть берётся из подписанного AMR, не из iat обновлённого JWT.
-- Техническое окно подтверждения: 5 минут; первый UI использует TOTP.
create function platform_private.require_recent_mfa() returns void
language plpgsql security invoker set search_path='' as $$
declare methods jsonb:=auth.jwt()->'amr'; item jsonb; confirmed_at numeric;
 current_epoch numeric:=extract(epoch from clock_timestamp());
begin
 if coalesce(auth.jwt()->>'aal','')='aal2' and jsonb_typeof(methods)='array' then
  for item in select value from jsonb_array_elements(methods) loop
   if item->>'method'='totp' and jsonb_typeof(item->'timestamp')='number'
     and (item->>'timestamp') ~ '^[0-9]{1,12}$' then
    confirmed_at:=(item->>'timestamp')::numeric;
    if confirmed_at<=current_epoch and confirmed_at>current_epoch-300 then return; end if;
   end if;
  end loop;
 end if;
 raise exception 'recent platform MFA required' using errcode='42501';
end; $$;
revoke all on function platform_private.require_recent_mfa() from public,anon,authenticated,service_role;

create or replace function public.require_platform_owner() returns void
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
 perform platform_private.require_recent_mfa();
end; $$;

alter table public.platform_audit_events
 add column before_assignment jsonb,
 add column after_assignment jsonb,
 add column command_id uuid;
alter table public.platform_audit_events drop constraint platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check
 check(action in ('assignment.created','assignment.updated','organization.summary.read','assignment.grant','assignment.revoke'));

-- Только поля назначения: не JWT, контакты, содержимое обращений или ответы.
create or replace function public.audit_platform_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_value jsonb; after_value jsonb;
begin
 if tg_op='UPDATE' then
  before_value:=jsonb_build_object('user_id',old.user_id,'role',old.role_key,'scope',old.scope_kind,
   'organization_id',old.organization_id,'support_case_id',old.support_case_id,
   'valid_from',old.valid_from,'expires_at',old.expires_at,'revoked_at',old.revoked_at);
 end if;
 after_value:=jsonb_build_object('user_id',new.user_id,'role',new.role_key,'scope',new.scope_kind,
  'organization_id',new.organization_id,'support_case_id',new.support_case_id,
  'valid_from',new.valid_from,'expires_at',new.expires_at,'revoked_at',new.revoked_at);
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action,before_assignment,after_assignment)
 values(auth.uid(),new.id,new.organization_id,case when tg_op='INSERT' then 'assignment.created' else 'assignment.updated' end,before_value,after_value);
 return new;
end; $$;

create function public.audit_platform_assignment_command() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action,command_id)
 select new.actor_id,new.assignment_id,a.organization_id,'assignment.'||(new.request->>'action'),new.command_id
 from public.platform_access_assignments a where a.id=new.assignment_id;
 return new;
end; $$;
revoke all on function public.audit_platform_assignment_command() from public,anon,authenticated,service_role;
create trigger platform_command_audit after insert on public.platform_assignment_commands
 for each row execute function public.audit_platform_assignment_command();
commit;
