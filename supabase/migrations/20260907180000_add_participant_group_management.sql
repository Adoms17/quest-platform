-- Permission-checked participant profile and family group management.

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
    case when account_link.user_id is not null then account_link.relationship else 'supervisor' end,
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
    and (account_link.user_id is not null or supervision.status in ('active', 'suspended'))
  order by participant.profile_kind desc, participant.created_at, participant.id;
$$;

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
    participant_group.created_by_user_id = auth.uid(),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_profile_id', participant.id,
        'display_name', participant.display_name,
        'age_group', participant.age_group,
        'member_role', group_member.member_role
      ) order by group_member.joined_at, participant.id)
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

create or replace function public.create_participant_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_group_id uuid;
  normalized_name text := nullif(btrim(p_name), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if normalized_name is null or char_length(normalized_name) > 100 then
    raise exception using errcode = '22023', message = 'invalid participant group name';
  end if;
  if (select count(*) from public.participant_groups where created_by_user_id = auth.uid() and status = 'active') >= 20 then
    raise exception using errcode = '22023', message = 'participant group limit reached';
  end if;

  insert into public.participant_groups (name, created_by_user_id)
  values (normalized_name, auth.uid())
  returning id into created_group_id;
  return created_group_id;
end;
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
  if p_group_id is not null and not exists (
    select 1 from public.participant_groups participant_group
    where participant_group.id = p_group_id
      and participant_group.created_by_user_id = auth.uid()
      and participant_group.status = 'active'
  ) then
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

create or replace function public.set_my_participant_supervision_status(
  p_participant_profile_id uuid,
  p_status text
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
  if p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'invalid supervision status';
  end if;

  update public.participant_supervisions
  set status = p_status, updated_at = now()
  where supervisor_user_id = auth.uid()
    and participant_profile_id = p_participant_profile_id
    and status <> 'revoked';

  if not found then
    raise exception using errcode = '42501', message = 'participant supervision denied';
  end if;
end;
$$;

revoke all on function public.get_my_participant_profiles() from public;
revoke all on function public.get_my_participant_groups() from public;
revoke all on function public.create_participant_group(text) from public;
revoke all on function public.create_dependent_participant_profile(text, text, uuid) from public;
revoke all on function public.set_my_participant_supervision_status(uuid, text) from public;
grant execute on function public.get_my_participant_profiles() to authenticated;
grant execute on function public.get_my_participant_groups() to authenticated;
grant execute on function public.create_participant_group(text) to authenticated;
grant execute on function public.create_dependent_participant_profile(text, text, uuid) to authenticated;
grant execute on function public.set_my_participant_supervision_status(uuid, text) to authenticated;
