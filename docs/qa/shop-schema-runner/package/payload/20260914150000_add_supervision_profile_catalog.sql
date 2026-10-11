-- Только собственные связи, включая отозванные. Наличие строки не даёт доступа к прохождению.
create or replace function public.search_my_participant_supervision_profiles(
  p_search text default '', p_after jsonb default null, p_limit integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan
as $$
declare
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_name text; v_id uuid; v_priority integer;
  v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='people catalog access denied';
  end if;
  if length(v_search)>200 then
    raise exception using errcode='22023', message='invalid people search';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or (p_after->>'actor_id') is distinct from auth.uid()::text
      or (p_after->>'kind') is distinct from 'supervision-profiles'
      or (p_after->>'search') is distinct from v_search
      or jsonb_typeof(p_after->'name') is distinct from 'string'
      or coalesce(p_after->>'priority','') not in ('0','1')
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
  with permitted as (
    select p.id, p.display_name, p.status profile_status, s.status supervision_status,
      0 sort_priority, lower(p.display_name) sort_name
    from public.participant_supervisions s
    join public.participant_profiles p on p.id=s.participant_profile_id
    where s.supervisor_user_id=auth.uid()
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
  return jsonb_build_object('items',v_rows,'has_more',v_more,'next_cursor',
    case when v_more then jsonb_build_object('actor_id',auth.uid(),'kind','supervision-profiles',
      'search',v_search,'priority',v_last->'sort_priority','name',v_last->>'sort_name','id',v_last->>'id') else null end);
end;
$$;
revoke all on function public.search_my_participant_supervision_profiles(text,jsonb,integer) from public, anon;
grant execute on function public.search_my_participant_supervision_profiles(text,jsonb,integer) to authenticated;

