-- Карточка одного профиля; разрешения соответствуют существующим RPC.
create or replace function public.get_participant_profile_card(p_participant_profile_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
set jit = off
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='participant profile access denied';
  end if;
  select jsonb_build_object(
    'id',p.id,'display_name',p.display_name,'profile_kind',p.profile_kind,'age_group',p.age_group,
    'is_self',exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id and a.user_id=auth.uid() and a.relationship='self' and a.status='active'),
    'supervision_status',s.status,
    'can_participate',public.can_access_participant_profile(p.id),
    'can_rename',exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id and a.user_id=auth.uid() and a.relationship='self' and a.status='active')
      or (p.created_by_user_id=auth.uid() and not exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id and a.relationship='self' and a.status='active'))
  ) into v_result
  from public.participant_profiles p
  left join public.participant_supervisions s on s.participant_profile_id=p.id and s.supervisor_user_id=auth.uid()
  where p.id=p_participant_profile_id and p.status='active'
    and (public.can_access_participant_profile(p.id) or s.status='suspended');
  if v_result is null then
    raise exception using errcode='42501', message='participant profile access denied';
  end if;
  return v_result;
end;
$$;
revoke all on function public.get_participant_profile_card(uuid) from public, anon;
grant execute on function public.get_participant_profile_card(uuid) to authenticated;
