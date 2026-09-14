create function public.search_participant_audit(p_participant_profile_id uuid,p_search text default '',p_after jsonb default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  v_manage boolean := public.can_manage_participant_supervisors(p_participant_profile_id);
  v_search text:=btrim(coalesce(p_search,''));
  v_limit integer:=least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id bigint; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if length(v_search)>200 then raise exception using errcode='22023',message='invalid invitation search'; end if;
  if p_after is not null then
    if p_after->>'can_manage'='true' and not v_manage then raise exception using errcode='42501',message='participant audit visibility changed'; end if;
    if jsonb_typeof(p_after) is distinct from 'object' or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'can_manage' is distinct from v_manage::text
      or p_after->>'participant_profile_id' is distinct from p_participant_profile_id::text or p_after->>'search' is distinct from v_search
      or nullif(p_after->>'id','') is null or nullif(p_after->>'created_at','') is null then
      raise exception using errcode='22023',message='invalid invitation cursor';
    end if;
    begin v_id:=(p_after->>'id')::bigint; v_date:=(p_after->>'created_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='invalid invitation cursor';
    end;
  end if;
  with page as (
    select e.id::text id,e.created_at,e.action,a.username actor_username,
      case when e.entity_type='supervision' then u.username else null end subject_username
    from public.participant_audit_events e
    left join public.profiles a on a.id=e.actor_user_id
    left join public.profiles u on e.entity_type='supervision' and u.id=e.entity_id
    where e.participant_profile_id=p_participant_profile_id and (v_manage or e.actor_user_id=auth.uid())
      and (v_search='' or strpos(lower(coalesce(a.username,'')||' '||case when e.entity_type='supervision' then coalesce(u.username,'') else '' end),lower(v_search))>0)
      and (p_after is null or (e.created_at,e.id)<(v_date,v_id))
    order by e.created_at desc,e.id desc limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id::bigint desc),'[]'::jsonb) into v_rows from page;
  v_more:=jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('profile_id',p_participant_profile_id,
    'items',v_rows,'has_more',v_more,'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'can_manage',v_manage,'participant_profile_id',p_participant_profile_id,'search',v_search,'id',v_last->>'id','created_at',v_last->>'created_at') else null end);
end;
$$;
revoke all on function public.search_participant_audit(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.search_participant_audit(uuid,text,jsonb,integer) to authenticated;
