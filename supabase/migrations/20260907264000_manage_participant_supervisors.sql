-- Complete the supervision lifecycle without exposing contact details.

alter table public.participant_supervisions
  add column if not exists revoked_at timestamp with time zone;

update public.participant_supervisions
set revoked_at = coalesce(revoked_at, updated_at, now())
where status = 'revoked';

alter table public.participant_supervisions
  add constraint participant_supervisions_revocation_check
  check ((status = 'revoked') = (revoked_at is not null));

create or replace function public.normalize_participant_supervision_revocation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'revoked' then
    new.revoked_at := coalesce(new.revoked_at, now());
  else
    new.revoked_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger participant_supervisions_normalize_revocation
before insert or update of status on public.participant_supervisions
for each row execute function public.normalize_participant_supervision_revocation();

create or replace function public.can_manage_participant_supervisors(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.participant_profiles participant
      where participant.id = target_profile_id
        and participant.created_by_user_id = auth.uid()
    )
    or exists (
      select 1 from public.participant_profile_accounts account_link
      where account_link.participant_profile_id = target_profile_id
        and account_link.user_id = auth.uid()
        and account_link.relationship = 'self'
        and account_link.status = 'active'
    )
  );
$$;

create or replace function public.get_managed_participant_supervisors()
returns table (
  participant_profile_id uuid,
  participant_display_name text,
  supervisor_user_id uuid,
  supervisor_username text,
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
    supervision.status
  from public.participant_profiles participant
  join public.participant_supervisions supervision
    on supervision.participant_profile_id = participant.id
  join public.profiles supervisor on supervisor.id = supervision.supervisor_user_id
  where public.can_manage_participant_supervisors(participant.id)
  order by participant.display_name, supervisor.username, supervision.supervisor_user_id;
$$;

create or replace function public.revoke_participant_supervisor(
  p_participant_profile_id uuid,
  p_supervisor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.can_manage_participant_supervisors(p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'participant supervision management denied';
  end if;

  update public.participant_supervisions supervision
  set status = 'revoked'
  where supervision.participant_profile_id = p_participant_profile_id
    and supervision.supervisor_user_id = p_supervisor_user_id
    and supervision.status <> 'revoked';

  if not found then
    raise exception using errcode = '22023', message = 'active participant supervision not found';
  end if;
end;
$$;

revoke all on function public.normalize_participant_supervision_revocation() from public, anon, authenticated;
revoke all on function public.can_manage_participant_supervisors(uuid) from public;
revoke all on function public.get_managed_participant_supervisors() from public;
revoke all on function public.revoke_participant_supervisor(uuid, uuid) from public;
grant execute on function public.can_manage_participant_supervisors(uuid) to authenticated;
grant execute on function public.get_managed_participant_supervisors() to authenticated;
grant execute on function public.revoke_participant_supervisor(uuid, uuid) to authenticated;
