-- A group leader must be able to act through their own account. Dependent
-- profiles without an account remain ordinary group members.

update public.participant_group_members group_member
set member_role = 'member'
where group_member.member_role = 'leader'
  and not exists (
    select 1 from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = group_member.participant_profile_id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
  );

create or replace function public.get_my_participant_groups()
returns table (
  group_id uuid,
  group_name text,
  group_status text,
  can_manage boolean,
  members jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    participant_group.id,
    participant_group.name,
    participant_group.status,
    public.can_manage_participant_group(participant_group.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_profile_id', participant.id,
        'display_name', participant.display_name,
        'age_group', participant.age_group,
        'profile_kind', participant.profile_kind,
        'member_role', group_member.member_role,
        'can_be_group_leader', exists (
          select 1 from public.participant_profile_accounts account_link
          where account_link.participant_profile_id = participant.id
            and account_link.relationship = 'self'
            and account_link.status = 'active'
        )
      ) order by group_member.member_role, group_member.joined_at, participant.id)
      from public.participant_group_members group_member
      join public.participant_profiles participant on participant.id = group_member.participant_profile_id
      where group_member.group_id = participant_group.id
        and group_member.status = 'active'
        and public.can_access_participant_profile(participant.id)
    ), '[]'::jsonb)
  from public.participant_groups participant_group
  where participant_group.status = 'active'
    and public.can_access_participant_group(participant_group.id)
  order by participant_group.created_at, participant_group.id;
$$;

create or replace function public.set_participant_group_member(
  p_group_id uuid,
  p_participant_profile_id uuid,
  p_member_role text default 'member',
  p_status text default 'active'
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
  if not public.can_manage_participant_group(p_group_id) then
    raise exception using errcode = '42501', message = 'participant group management denied';
  end if;
  if not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'participant profile access denied';
  end if;
  if p_member_role not in ('leader', 'member') or p_status not in ('active', 'removed') then
    raise exception using errcode = '22023', message = 'invalid participant group membership';
  end if;
  if p_member_role = 'leader' and not exists (
    select 1 from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = p_participant_profile_id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'participant group leader requires account';
  end if;

  insert into public.participant_group_members (
    group_id, participant_profile_id, member_role, status
  ) values (
    p_group_id, p_participant_profile_id, p_member_role, p_status
  )
  on conflict (group_id, participant_profile_id) do update
  set member_role = excluded.member_role,
      status = excluded.status,
      joined_at = case when excluded.status = 'active' then now() else participant_group_members.joined_at end;
end;
$$;
