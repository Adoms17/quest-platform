-- Make the group leader role enforceable instead of informational.

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
              and supervision.status = 'active'
          )
        )
    )
  );
$$;

create or replace function public.add_group_creator_as_leader()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.participant_group_members (
    group_id, participant_profile_id, member_role, status
  ) values (new.id, new.created_by_user_id, 'leader', 'active')
  on conflict (group_id, participant_profile_id) do update
  set member_role = 'leader', status = 'active';
  return new;
end;
$$;

create trigger participant_groups_add_creator_as_leader
after insert on public.participant_groups
for each row execute function public.add_group_creator_as_leader();

insert into public.participant_group_members (
  group_id, participant_profile_id, member_role, status
)
select participant_group.id, participant_group.created_by_user_id, 'leader', 'active'
from public.participant_groups participant_group
join public.participant_profiles participant
  on participant.id = participant_group.created_by_user_id
on conflict (group_id, participant_profile_id) do update
set member_role = 'leader', status = 'active';

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
      select 1 from public.participant_group_members group_member
      where group_member.participant_profile_id = target_profile_id
        and group_member.status = 'active'
        and public.can_manage_participant_group(group_member.group_id)
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
        'member_role', group_member.member_role
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
    and public.can_access_participant_profile(participant.id)
  order by participant.profile_kind desc, participant.created_at, participant.id;
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

revoke all on function public.can_manage_participant_group(uuid) from public;
revoke all on function public.add_group_creator_as_leader() from public, anon, authenticated;
revoke all on function public.set_participant_group_member(uuid, uuid, text, text) from public;
grant execute on function public.can_manage_participant_group(uuid) to authenticated;
grant execute on function public.set_participant_group_member(uuid, uuid, text, text) to authenticated;
