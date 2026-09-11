-- Supervision grants access to a participant profile, not to groups managed by
-- another account. A supervisor may add that profile to a group they manage.

create or replace function public.can_manage_participant_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.participant_groups participant_group
      where participant_group.id = target_group_id
        and participant_group.status = 'active'
        and participant_group.created_by_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.participant_group_members group_member
      where group_member.group_id = target_group_id
        and group_member.member_role = 'leader'
        and group_member.status = 'active'
        and exists (
          select 1 from public.participant_profile_accounts account_link
          where account_link.participant_profile_id = group_member.participant_profile_id
            and account_link.user_id = auth.uid()
            and account_link.status = 'active'
        )
    )
  );
$$;

create or replace function public.can_access_participant_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    public.can_manage_participant_group(target_group_id)
    or exists (
      select 1 from public.participant_group_members group_member
      where group_member.group_id = target_group_id
        and group_member.status = 'active'
        and exists (
          select 1 from public.participant_profile_accounts account_link
          where account_link.participant_profile_id = group_member.participant_profile_id
            and account_link.user_id = auth.uid()
            and account_link.status = 'active'
        )
    )
  );
$$;
