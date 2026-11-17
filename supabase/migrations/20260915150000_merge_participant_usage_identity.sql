-- Факты регистрации неизменны, эквивалентность профилей хранится отдельно.
create table public.participant_usage_profile_merges (
  source_profile_id uuid not null,
  target_profile_id uuid not null,
  merged_at timestamptz not null default statement_timestamp(),
  primary key(source_profile_id,target_profile_id),
  check(source_profile_id<>target_profile_id)
);
create index participant_usage_merge_target_idx on public.participant_usage_profile_merges(target_profile_id);
alter table public.participant_usage_profile_merges enable row level security;
revoke all on public.participant_usage_profile_merges from public,anon,authenticated;

create function public.participant_usage_identity(p_profile_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  with recursive identities(id) as (
    select p_profile_id
    union
    select case when m.source_profile_id=i.id then m.target_profile_id else m.source_profile_id end
    from identities i join public.participant_usage_profile_merges m
      on m.source_profile_id=i.id or m.target_profile_id=i.id
  ) select min(id::text)::uuid from identities;
$$;
revoke all on function public.participant_usage_identity(uuid) from public,anon,authenticated;

-- Merge the automatically provisioned self profile into the claimed profile.
-- Active attempts are never silently altered; the user must finish them first.

create or replace function public.accept_participant_profile_invitation(p_token text)
returns table (participant_profile_id uuid, invitation_kind text)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation public.participant_profile_invitations%rowtype;
  old_self_profile_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select lower(email) into current_email from auth.users where id = current_user_id;
  select * into invitation from public.participant_profile_invitations candidate
  where candidate.token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found then raise exception using errcode = '22023', message = 'invalid participant invitation'; end if;
  if invitation.status = 'accepted' and invitation.accepted_by_user_id = current_user_id then
    return query select invitation.participant_profile_id, invitation.invitation_kind;
    return;
  end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now() then
    raise exception using errcode = '22023', message = 'participant invitation is not active';
  end if;
  if current_email is null or current_email <> invitation.email then
    raise exception using errcode = '42501', message = 'participant invitation belongs to another account';
  end if;

  if invitation.invitation_kind = 'supervisor' then
    insert into public.participant_supervisions (supervisor_user_id, participant_profile_id, status)
    values (current_user_id, invitation.participant_profile_id, 'active')
    on conflict on constraint participant_supervisions_pkey do update
      set status = 'active', updated_at = now();
  else
    if exists (
      select 1 from public.participant_profile_accounts account_link
      where account_link.participant_profile_id = invitation.participant_profile_id
        and account_link.relationship = 'self' and account_link.status = 'active'
        and account_link.user_id <> current_user_id
    ) then
      raise exception using errcode = '22023', message = 'participant profile already has an account';
    end if;

    select account_link.participant_profile_id into old_self_profile_id
    from public.participant_profile_accounts account_link
    where account_link.user_id = current_user_id
      and account_link.relationship = 'self' and account_link.status = 'active'
    for update;

    if old_self_profile_id is distinct from invitation.participant_profile_id then
      if exists (
        select 1 from public.quest_attempts attempt
        where attempt.participant_profile_id = old_self_profile_id
          and attempt.finished_at is null
      ) then
        raise exception using errcode = '55000', message = 'self participant profile has active quest attempt';
      end if;

      if old_self_profile_id is not null then
        insert into public.participant_usage_profile_merges(source_profile_id,target_profile_id)
        values(old_self_profile_id,invitation.participant_profile_id) on conflict do nothing;
      end if;

      update public.participant_profile_accounts account_link
      set status = 'revoked', revoked_at = now()
      where account_link.user_id = current_user_id
        and account_link.relationship = 'self' and account_link.status = 'active';

      insert into public.participant_group_members (group_id, participant_profile_id, member_role, status)
      select old_group_member.group_id, invitation.participant_profile_id,
        old_group_member.member_role, old_group_member.status
      from public.participant_group_members old_group_member
      where old_group_member.participant_profile_id = old_self_profile_id
      on conflict on constraint participant_group_members_pkey do update
        set member_role = case
          when excluded.member_role = 'leader' then 'leader'
          else participant_group_members.member_role
        end,
        status = case
          when excluded.status = 'active' then 'active'
          else participant_group_members.status
        end;

      update public.quest_access_grants old_grant
      set status = 'revoked', revoked_at = coalesce(old_grant.revoked_at, now())
      where old_grant.participant_profile_id = old_self_profile_id
        and old_grant.status = 'active'
        and exists (
          select 1 from public.quest_access_grants target_grant
          where target_grant.participant_profile_id = invitation.participant_profile_id
            and target_grant.quest_id = old_grant.quest_id
            and target_grant.status = 'active'
        );

      update public.quest_access_grants access_grant
      set participant_profile_id = invitation.participant_profile_id
      where access_grant.participant_profile_id = old_self_profile_id;

      update public.quest_attempts attempt
      set participant_profile_id = invitation.participant_profile_id
      where attempt.participant_profile_id = old_self_profile_id;

      update public.participant_audit_events audit_event
      set participant_profile_id = invitation.participant_profile_id
      where audit_event.participant_profile_id = old_self_profile_id;

      update public.participant_profiles participant
      set status = 'archived', updated_at = now()
      where participant.id = old_self_profile_id
        and participant.profile_kind = 'self'
        and participant.created_by_user_id = current_user_id;
    end if;

    insert into public.participant_profile_accounts (participant_profile_id, user_id, relationship, status)
    values (invitation.participant_profile_id, current_user_id, 'self', 'active')
    on conflict on constraint participant_profile_accounts_pkey do update
      set relationship = 'self', status = 'active', revoked_at = null;
    update public.participant_profiles participant
    set profile_kind = 'self', updated_at = now()
    where participant.id = invitation.participant_profile_id;
  end if;

  update public.participant_profile_invitations target_invitation
  set status = 'accepted', accepted_by_user_id = current_user_id,
    accepted_at = now(), updated_at = now()
  where target_invitation.id = invitation.id;
  return query select invitation.participant_profile_id, invitation.invitation_kind;
end;
$$;

create or replace function public.get_monthly_participant_usage(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  month_start timestamp := date_trunc('month', statement_timestamp() at time zone 'Europe/Moscow');
  starts timestamptz := month_start at time zone 'Europe/Moscow';
  ends timestamptz := (month_start + interval '1 month') at time zone 'Europe/Moscow';
  coverage timestamptz;
  participants bigint;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.read') then
    raise exception 'billing access denied' using errcode='42501';
  end if;
  select started_at into coverage from public.participant_usage_coverage where singleton;
  if coverage is not null then
    select count(distinct public.participant_usage_identity(participant_profile_id)) into participants
    from public.participant_usage_registrations
    where organization_id=p_organization_id and period_start=starts
      and registered_at >= greatest(starts,coverage) and registered_at < ends;
  end if;
  return jsonb_build_object('organization_id',p_organization_id,
    'period_start',starts,'period_end',ends,'timezone','Europe/Moscow',
    'coverage_started_at',coverage,'is_partial',coverage is null or coverage > starts,
    'participants',participants,'enforcement_enabled',false,'measured_at',statement_timestamp());
end;
$$;
revoke all on function public.get_monthly_participant_usage(uuid) from public, anon, authenticated;
grant execute on function public.get_monthly_participant_usage(uuid) to authenticated;
comment on function public.get_monthly_participant_usage(uuid) is
  'Наблюдение текущего месяца с учётом объединённых профилей, без лимита/доплаты. Неполное покрытие отмечено явно; исходные факты сохраняются, итог может уменьшаться после объединения.';
