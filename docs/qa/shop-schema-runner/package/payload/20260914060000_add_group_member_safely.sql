-- Добавление не должно менять роль уже активного участника при retry.
create function public.add_participant_group_member(p_group_id uuid, p_participant_profile_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.can_manage_participant_group(p_group_id) then
    raise exception using errcode='42501', message='participant group management denied';
  end if;
  if not exists(select 1 from public.participant_profiles p where p.id=p_participant_profile_id and p.status='active')
    or not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode='42501', message='participant profile access denied';
  end if;
  insert into public.participant_group_members(group_id, participant_profile_id, member_role, status)
    values(p_group_id, p_participant_profile_id, 'member', 'active')
  on conflict(group_id, participant_profile_id) do update
    set member_role='member', status='active', joined_at=now()
    where participant_group_members.status='removed';
end;
$$;
revoke all on function public.add_participant_group_member(uuid,uuid) from public,anon;
grant execute on function public.add_participant_group_member(uuid,uuid) to authenticated;
