-- Supervisors may see groups containing a supervised participant, while only
-- creators and accounts controlling a leader profile may manage those groups.

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
      select 1
      from public.participant_group_members group_member
      where group_member.group_id = target_group_id
        and group_member.status = 'active'
        and (
          exists (
            select 1 from public.participant_profile_accounts account_link
            where account_link.participant_profile_id = group_member.participant_profile_id
              and account_link.user_id = auth.uid()
              and account_link.status = 'active'
          )
          or exists (
            select 1 from public.participant_supervisions supervision
            where supervision.participant_profile_id = group_member.participant_profile_id
              and supervision.supervisor_user_id = auth.uid()
              and supervision.status in ('active', 'suspended')
          )
        )
    )
  );
$$;
