-- Return enough identity context to distinguish profiles with equal display
-- names. These fields are exposed only through permission-checked RPCs.

drop function if exists public.get_my_participant_profiles();

create function public.get_my_participant_profiles()
returns table (
  participant_profile_id uuid,
  display_name text,
  profile_kind text,
  age_group text,
  profile_status text,
  relationship text,
  supervision_status text,
  account_username text,
  account_email text,
  owner_username text,
  owner_email text
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
      when own_account.user_id is not null then own_account.relationship
      when supervision.supervisor_user_id is not null then 'supervisor'
      else 'group_manager'
    end,
    supervision.status,
    linked_profile.username,
    linked_user.email::text,
    owner_profile.username,
    owner_user.email::text
  from public.participant_profiles participant
  left join lateral (
    select account_link.user_id
    from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = participant.id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
    order by account_link.linked_at, account_link.user_id
    limit 1
  ) linked_account on true
  left join public.profiles linked_profile on linked_profile.id = linked_account.user_id
  left join auth.users linked_user on linked_user.id = linked_account.user_id
  left join public.participant_profile_accounts own_account
    on own_account.participant_profile_id = participant.id
   and own_account.user_id = auth.uid()
   and own_account.status = 'active'
  left join public.participant_supervisions supervision
    on supervision.participant_profile_id = participant.id
   and supervision.supervisor_user_id = auth.uid()
  left join public.profiles owner_profile on owner_profile.id = participant.created_by_user_id
  left join auth.users owner_user on owner_user.id = participant.created_by_user_id
  where auth.uid() is not null
    and participant.status = 'active'
    and (
      public.can_access_participant_profile(participant.id)
      or supervision.status = 'suspended'
    )
  order by participant.profile_kind desc, participant.created_at, participant.id;
$$;

create or replace function public.get_my_participant_groups()
returns table (
  group_id uuid,
  group_name text,
  group_status text,
  can_manage boolean,
  created_by_current_user boolean,
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
    participant_group.created_by_user_id = auth.uid(),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_profile_id', participant.id,
        'display_name', participant.display_name,
        'age_group', participant.age_group,
        'profile_kind', participant.profile_kind,
        'member_role', group_member.member_role,
        'account_username', linked_profile.username,
        'account_email', linked_user.email,
        'owner_username', owner_profile.username,
        'owner_email', owner_user.email,
        'is_current_user', exists (
          select 1 from public.participant_profile_accounts current_account
          where current_account.participant_profile_id = participant.id
            and current_account.user_id = auth.uid()
            and current_account.relationship = 'self'
            and current_account.status = 'active'
        ),
        'can_be_group_leader', linked_account.user_id is not null
      ) order by group_member.member_role, group_member.joined_at, participant.id)
      from public.participant_group_members group_member
      join public.participant_profiles participant on participant.id = group_member.participant_profile_id
      left join lateral (
        select account_link.user_id
        from public.participant_profile_accounts account_link
        where account_link.participant_profile_id = participant.id
          and account_link.relationship = 'self'
          and account_link.status = 'active'
        order by account_link.linked_at, account_link.user_id
        limit 1
      ) linked_account on true
      left join public.profiles linked_profile on linked_profile.id = linked_account.user_id
      left join auth.users linked_user on linked_user.id = linked_account.user_id
      left join public.profiles owner_profile on owner_profile.id = participant.created_by_user_id
      left join auth.users owner_user on owner_user.id = participant.created_by_user_id
      where group_member.group_id = participant_group.id
        and group_member.status = 'active'
        and participant.status = 'active'
        and public.can_access_participant_profile(participant.id)
    ), '[]'::jsonb)
  from public.participant_groups participant_group
  where participant_group.status = 'active'
    and public.can_access_participant_group(participant_group.id)
  order by participant_group.created_at, participant_group.id;
$$;

grant execute on function public.get_my_participant_profiles() to authenticated;
grant execute on function public.get_my_participant_groups() to authenticated;
