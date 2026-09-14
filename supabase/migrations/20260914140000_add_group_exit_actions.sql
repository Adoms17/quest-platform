-- Состав одной доступной группы. Каждый профиль проверяется независимо.
-- Эквивалентно третьей ветви can_access_participant_profile: строка уже
-- имеет active membership в p_group_id, can_manage этой группы проверен выше.
-- Контакты и общее число скрытых участников не возвращаются.
create or replace function public.search_participant_group_members(
  p_group_id uuid, p_search text default '', p_after jsonb default null, p_limit integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan
set jit = off
as $$
declare
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_name text; v_id uuid; v_priority integer; v_group jsonb; v_manage boolean;
  v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='people catalog access denied';
  end if;
  select jsonb_build_object('id',g.id,'name',g.name,
    'can_manage',public.can_manage_participant_group(g.id),
    'can_leave',g.created_by_user_id<>auth.uid() and exists(select 1 from public.participant_group_members m where m.group_id=g.id and m.status='active' and m.participant_profile_id=public.current_self_participant_profile_id())) into v_group
  from public.participant_groups g where g.id=p_group_id and g.status='active'
    and public.can_access_participant_group(g.id);
  if v_group is null then
    raise exception using errcode='42501', message='people catalog access denied';
  end if;
  v_manage := (v_group->>'can_manage')::boolean;
  if length(v_search)>200 then
    raise exception using errcode='22023', message='invalid people search';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or (p_after->>'actor_id') is distinct from auth.uid()::text
      or (p_after->>'kind') is distinct from 'members'
      or (p_after->>'group_id') is distinct from p_group_id::text
      or (p_after->>'search') is distinct from v_search
      or jsonb_typeof(p_after->'name') is distinct from 'string'
      or coalesce(p_after->>'priority','') not in ('0','1','2')
      or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023', message='invalid people cursor';
    end if;
    begin
      v_name := p_after->>'name'; v_priority := (p_after->>'priority')::integer;
      v_id := (p_after->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023', message='invalid people cursor';
    end;
  end if;
  -- Те же три ветви can_access_participant_profile. Права связанных групп
  -- вычисляются один раз, а не для каждого участника выдачи.
  with relevant_groups as materialized (
    select distinct related.group_id
    from public.participant_group_members target
    join public.participant_group_members related
      on related.participant_profile_id=target.participant_profile_id and related.status='active'
    where target.group_id=p_group_id and target.status='active'
  ), managed_groups as materialized (
    select group_id from relevant_groups where public.can_manage_participant_group(group_id)
  ), accessible as materialized (
    select participant_profile_id from public.participant_profile_accounts
      where user_id=auth.uid() and status='active'
    union select participant_profile_id from public.participant_supervisions
      where supervisor_user_id=auth.uid() and status='active'
    union select participant_profile_id from public.participant_group_members
      where status='active' and group_id in (select group_id from managed_groups)
  ), permitted as (
    select p.id,p.display_name,p.profile_kind,m.member_role,
      exists(select 1 from public.participant_profile_accounts a
        where a.participant_profile_id=p.id and a.user_id=auth.uid()
          and a.relationship='self' and a.status='active') is_current_user,
      case when exists(select 1 from public.participant_profile_accounts a
        where a.participant_profile_id=p.id and a.user_id=auth.uid()
          and a.relationship='self' and a.status='active') then 0
        when m.member_role='leader' then 1 else 2 end sort_priority,
      lower(p.display_name) sort_name
    from public.participant_group_members m
    join public.participant_profiles p on p.id=m.participant_profile_id
    where m.group_id=p_group_id and m.status='active' and p.status='active'
      and (v_manage or p.id in (select participant_profile_id from accessible))
      and (v_search='' or strpos(lower(p.display_name),lower(v_search))>0)
  ), page as materialized (
    select * from permitted
    where p_after is null or (sort_priority,sort_name,id)>(v_priority,v_name,v_id)
    order by sort_priority,sort_name,id limit v_limit+1
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by sort_priority,sort_name,id),'[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows := v_rows - v_limit; end if;
  v_last := v_rows -> (jsonb_array_length(v_rows)-1);
  return jsonb_build_object('group',v_group,'items',v_rows,'has_more',v_more,'next_cursor',
    case when v_more then jsonb_build_object('actor_id',auth.uid(),'kind','members','group_id',p_group_id,
      'search',v_search,'priority',v_last->'sort_priority','name',v_last->>'sort_name','id',v_last->>'id') else null end);
end;
$$;
revoke all on function public.search_participant_group_members(uuid,text,jsonb,integer) from public, anon;
grant execute on function public.search_participant_group_members(uuid,text,jsonb,integer) to authenticated;

create function public.remove_participant_group_member(p_group_id uuid,p_participant_profile_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.can_manage_participant_group(p_group_id) then
   raise exception using errcode='42501',message='participant group management denied';
 end if;
 update public.participant_group_members set status='removed'
 where group_id=p_group_id and participant_profile_id=p_participant_profile_id and status='active';
end;
$$;
revoke all on function public.remove_participant_group_member(uuid,uuid) from public,anon;
grant execute on function public.remove_participant_group_member(uuid,uuid) to authenticated;
