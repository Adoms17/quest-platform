-- Keep suspended supervision recoverable, preserve a user's own audit history,
-- and prevent dependent participant profiles from losing their last guardian.

create or replace function public.get_my_participant_profiles()
returns table (
  participant_profile_id uuid,
  display_name text,
  profile_kind text,
  age_group text,
  profile_status text,
  relationship text,
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
    participant.profile_kind,
    participant.age_group,
    participant.status,
    case
      when account_link.user_id is not null then account_link.relationship
      when supervision.supervisor_user_id is not null then 'supervisor'
      else 'group_manager'
    end,
    supervision.status
  from public.participant_profiles participant
  left join public.participant_profile_accounts account_link
    on account_link.participant_profile_id = participant.id
   and account_link.user_id = auth.uid()
   and account_link.status = 'active'
  left join public.participant_supervisions supervision
    on supervision.participant_profile_id = participant.id
   and supervision.supervisor_user_id = auth.uid()
  where auth.uid() is not null
    and participant.status = 'active'
    and (
      public.can_access_participant_profile(participant.id)
      or supervision.status = 'suspended'
    )
  order by participant.profile_kind desc, participant.created_at, participant.id;
$$;

create or replace function public.get_my_participant_audit_feed(p_limit integer default 50)
returns table (
  id bigint,
  participant_profile_id uuid,
  participant_display_name text,
  actor_username text,
  subject_username text,
  action text,
  entity_type text,
  metadata jsonb,
  created_at timestamp with time zone
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    event.id,
    event.participant_profile_id,
    participant.display_name,
    actor.username,
    case when event.entity_type = 'supervision' then subject.username else null end,
    event.action,
    event.entity_type,
    event.metadata - array['email', 'phone', 'token', 'token_hash', 'latitude', 'longitude'],
    event.created_at
  from public.participant_audit_events event
  join public.participant_profiles participant on participant.id = event.participant_profile_id
  left join public.profiles actor on actor.id = event.actor_user_id
  left join public.profiles subject
    on event.entity_type = 'supervision' and subject.id = event.entity_id
  where public.can_manage_participant_supervisors(event.participant_profile_id)
     or event.actor_user_id = auth.uid()
  order by event.created_at desc, event.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.restore_orphaned_participant_supervision(
  p_participant_profile_id uuid
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
  if not exists (
    select 1 from public.participant_profiles participant
    where participant.id = p_participant_profile_id
      and participant.profile_kind = 'dependent'
      and participant.status = 'active'
      and participant.created_by_user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'participant supervision recovery denied';
  end if;
  if exists (
    select 1 from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = p_participant_profile_id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
  ) or exists (
    select 1 from public.participant_supervisions supervision
    where supervision.participant_profile_id = p_participant_profile_id
      and supervision.status in ('active', 'suspended')
  ) then
    raise exception using errcode = '22023', message = 'participant profile is not orphaned';
  end if;

  insert into public.participant_supervisions (
    supervisor_user_id, participant_profile_id, status, updated_at
  ) values (
    auth.uid(), p_participant_profile_id, 'active', now()
  ) on conflict on constraint participant_supervisions_pkey do update
    set status = 'active', updated_at = now();
end;
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
  if not exists (
    select 1 from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = p_participant_profile_id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
  ) and not exists (
    select 1 from public.participant_supervisions supervision
    where supervision.participant_profile_id = p_participant_profile_id
      and supervision.supervisor_user_id <> p_supervisor_user_id
      and supervision.status in ('active', 'suspended')
  ) then
    raise exception using errcode = '22023', message = 'last participant supervisor cannot be revoked';
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

revoke all on function public.restore_orphaned_participant_supervision(uuid) from public, anon, authenticated;
grant execute on function public.restore_orphaned_participant_supervision(uuid) to authenticated;
