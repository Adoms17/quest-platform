-- Let participant profile managers distinguish supervisors with identical names.
-- Contact details remain available only through the permission-checked RPC.

drop function if exists public.get_managed_participant_supervisors();

create function public.get_managed_participant_supervisors()
returns table (
  participant_profile_id uuid,
  participant_display_name text,
  supervisor_user_id uuid,
  supervisor_username text,
  supervisor_email text,
  supervision_status text
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
    supervision.status
  from public.participant_profiles participant
  join public.participant_supervisions supervision
    on supervision.participant_profile_id = participant.id
  join public.profiles supervisor on supervisor.id = supervision.supervisor_user_id
  join auth.users account on account.id = supervision.supervisor_user_id
  where public.can_manage_participant_supervisors(participant.id)
  order by participant.display_name, supervisor.username, account.email, supervision.supervisor_user_id;
$$;

revoke all on function public.get_managed_participant_supervisors() from public, anon, authenticated;
grant execute on function public.get_managed_participant_supervisors() to authenticated;
