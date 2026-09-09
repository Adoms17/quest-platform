-- Group leadership is an independent source of participant supervision.
-- A leader can use and manage every active profile in the group. Explicit
-- per-profile supervision remains available outside group membership.

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
    or exists (
      select 1
      from public.participant_group_members target_member
      where target_member.participant_profile_id = target_profile_id
        and target_member.status = 'active'
        and public.can_manage_participant_group(target_member.group_id)
    )
  );
$$;

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
    or exists (
      select 1
      from public.participant_group_members target_member
      where target_member.participant_profile_id = target_profile_id
        and target_member.status = 'active'
        and public.can_manage_participant_group(target_member.group_id)
    )
  );
$$;

create or replace function public.create_dependent_participant_profile(
  p_display_name text,
  p_age_group text default 'unknown',
  p_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_profile_id uuid;
  normalized_name text := nullif(btrim(p_display_name), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if normalized_name is null or char_length(normalized_name) > 100 then
    raise exception using errcode = '22023', message = 'invalid participant display name';
  end if;
  if p_age_group not in ('unknown', 'child', 'teen', 'adult') then
    raise exception using errcode = '22023', message = 'invalid participant age group';
  end if;
  if (select count(*) from public.participant_profiles where created_by_user_id = auth.uid() and profile_kind = 'dependent' and status = 'active') >= 20 then
    raise exception using errcode = '22023', message = 'dependent participant profile limit reached';
  end if;
  if p_group_id is not null and not public.can_manage_participant_group(p_group_id) then
    raise exception using errcode = '42501', message = 'participant group management denied';
  end if;

  insert into public.participant_profiles (display_name, profile_kind, age_group, created_by_user_id)
  values (normalized_name, 'dependent', p_age_group, auth.uid())
  returning id into created_profile_id;

  insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
  values (auth.uid(), created_profile_id);

  if p_group_id is not null then
    insert into public.participant_group_members (group_id, participant_profile_id)
    values (p_group_id, created_profile_id);
  end if;
  return created_profile_id;
end;
$$;

create or replace function public.leave_participant_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  self_profile_id uuid := public.current_self_participant_profile_id();
begin
  if exists (
    select 1 from public.participant_groups
    where id = p_group_id and created_by_user_id = auth.uid()
  ) then
    raise exception using errcode = '22023', message = 'participant group creator cannot leave';
  end if;

  if not exists (
    select 1 from public.participant_group_members
    where group_id = p_group_id
      and participant_profile_id = self_profile_id
      and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'participant group membership denied';
  end if;

  update public.participant_group_members group_member
  set status = 'removed'
  where group_member.group_id = p_group_id
    and group_member.status = 'active'
    and (
      group_member.participant_profile_id = self_profile_id
      or exists (
        select 1 from public.participant_profiles participant
        where participant.id = group_member.participant_profile_id
          and participant.created_by_user_id = auth.uid()
          and participant.profile_kind = 'dependent'
          and not exists (
            select 1 from public.participant_profile_accounts account_link
            where account_link.participant_profile_id = participant.id
              and account_link.relationship = 'self'
              and account_link.status = 'active'
          )
      )
    );
end;
$$;

grant execute on function public.can_access_participant_profile(uuid) to authenticated;
grant execute on function public.can_manage_participant_supervisors(uuid) to authenticated;
grant execute on function public.create_dependent_participant_profile(text, text, uuid) to authenticated;
grant execute on function public.leave_participant_group(uuid) to authenticated;
