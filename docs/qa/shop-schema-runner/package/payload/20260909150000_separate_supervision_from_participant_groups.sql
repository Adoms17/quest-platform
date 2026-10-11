-- A participant group never grants access to a participant profile by itself.
-- Supervisors can relinquish their own access, while profile creators retain
-- recovery visibility without retaining participant access.

create or replace function public.can_access_participant_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.participant_profile_accounts account_link
      where account_link.participant_profile_id = target_profile_id
        and account_link.user_id = auth.uid()
        and account_link.status = 'active'
    )
    or exists (
      select 1 from public.participant_supervisions supervision
      where supervision.participant_profile_id = target_profile_id
        and supervision.supervisor_user_id = auth.uid()
        and supervision.status = 'active'
    )
  );
$$;

drop function public.get_managed_participant_supervisors();
create function public.get_managed_participant_supervisors()
returns table (
  participant_profile_id uuid,
  participant_display_name text,
  supervisor_user_id uuid,
  supervisor_username text,
  supervisor_email text,
  supervision_status text,
  can_manage boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    participant.id,
    participant.display_name,
    supervision.supervisor_user_id,
    supervisor.username,
    account.email::text,
    supervision.status,
    public.can_manage_participant_supervisors(participant.id)
  from public.participant_profiles participant
  join public.participant_supervisions supervision
    on supervision.participant_profile_id = participant.id
  join public.profiles supervisor on supervisor.id = supervision.supervisor_user_id
  join auth.users account on account.id = supervision.supervisor_user_id
  where public.can_manage_participant_supervisors(participant.id)
     or supervision.supervisor_user_id = auth.uid()
  order by participant.display_name, supervisor.username, account.email, supervision.supervisor_user_id;
$$;

create or replace function public.revoke_my_participant_supervision(
  p_participant_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_is_creator boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select participant.created_by_user_id = auth.uid()
  into current_user_is_creator
  from public.participant_profiles participant
  where participant.id = p_participant_profile_id
    and participant.status = 'active';

  if current_user_is_creator and not exists (
    select 1 from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = p_participant_profile_id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
  ) and not exists (
    select 1 from public.participant_supervisions supervision
    where supervision.participant_profile_id = p_participant_profile_id
      and supervision.supervisor_user_id <> auth.uid()
      and supervision.status in ('active', 'suspended')
  ) then
    raise exception using errcode = '22023', message = 'last participant supervisor cannot be revoked';
  end if;

  update public.participant_supervisions supervision
  set status = 'revoked'
  where supervision.participant_profile_id = p_participant_profile_id
    and supervision.supervisor_user_id = auth.uid()
    and supervision.status <> 'revoked';

  if not found then
    raise exception using errcode = '42501', message = 'participant supervision denied';
  end if;
end;
$$;

revoke all on function public.get_managed_participant_supervisors() from public, anon, authenticated;
revoke all on function public.revoke_my_participant_supervision(uuid) from public, anon, authenticated;
grant execute on function public.get_managed_participant_supervisors() to authenticated;
grant execute on function public.revoke_my_participant_supervision(uuid) to authenticated;
