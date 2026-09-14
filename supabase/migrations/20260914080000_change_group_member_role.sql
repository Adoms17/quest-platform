-- Узкая смена роли: не добавляет и не восстанавливает членство.
create function public.change_participant_group_member_role(p_group_id uuid,p_participant_profile_id uuid,p_expected_role text,p_new_role text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text; v_status text;
begin
  if auth.uid() is null or not public.can_manage_participant_group(p_group_id) then
    raise exception using errcode='42501',message='participant group management denied';
  end if;
  if p_expected_role is null or p_new_role is null or p_expected_role not in ('member','leader') or p_new_role not in ('member','leader') then
    raise exception using errcode='22023',message='invalid participant group membership';
  end if;
  select member_role,status into v_role,v_status from public.participant_group_members
    where group_id=p_group_id and participant_profile_id=p_participant_profile_id for update;
  if not found or v_status<>'active' then
    raise exception using errcode='40001',message='participant group membership changed';
  end if;
  if not public.can_manage_participant_group(p_group_id) then raise exception using errcode='42501',message='participant group management denied'; end if;
  if v_role=p_new_role then return; end if;
  if v_role<>p_expected_role then raise exception using errcode='40001',message='participant group membership changed'; end if;
  if p_new_role='leader' and not exists(select 1 from public.participant_profile_accounts where participant_profile_id=p_participant_profile_id and relationship='self' and status='active') then
    raise exception using errcode='22023',message='participant group leader requires account';
  end if;
  update public.participant_group_members set member_role=p_new_role
    where group_id=p_group_id and participant_profile_id=p_participant_profile_id;
end; $$;
revoke all on function public.change_participant_group_member_role(uuid,uuid,text,text) from public,anon;
grant execute on function public.change_participant_group_member_role(uuid,uuid,text,text) to authenticated;
