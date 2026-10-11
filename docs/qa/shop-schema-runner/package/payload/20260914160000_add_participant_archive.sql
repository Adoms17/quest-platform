-- Архив сохраняет прежнюю видимость собственных приглашений и разрешённого журнала.
-- Только собственные связи, включая отозванные. Наличие строки не даёт доступа к прохождению.
create or replace function public.search_my_participant_archive(
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
      or (p_after->>'kind') is distinct from 'archive'
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
    select p.id, p.display_name, 'profile' kind, 0 sort_priority, lower(p.display_name) sort_name
    from public.participant_profiles p
    where (exists(select 1 from public.participant_profile_invitations i where i.participant_profile_id=p.id and i.created_by_user_id=auth.uid())
      or exists(select 1 from public.participant_audit_events e where e.participant_profile_id=p.id and (e.actor_user_id=auth.uid() or public.can_manage_participant_supervisors(p.id))))
      and (v_search='' or strpos(lower(p.display_name),lower(v_search))>0)
    union all
    select g.id,g.name,'group',1,lower(g.name)
    from public.participant_groups g
    where exists(select 1 from public.participant_group_invitations i where i.group_id=g.id and i.created_by_user_id=auth.uid())
      and (v_search='' or strpos(lower(g.name),lower(v_search))>0)
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
  return jsonb_build_object('items',(select coalesce(jsonb_agg(item || jsonb_build_object('target_id',item->>'id','id',(item->>'kind')||':'||(item->>'id'))),'[]'::jsonb) from jsonb_array_elements(v_rows) item),'has_more',v_more,'next_cursor',
    case when v_more then jsonb_build_object('actor_id',auth.uid(),'kind','archive',
      'search',v_search,'priority',v_last->'sort_priority','name',v_last->>'sort_name','id',v_last->>'id') else null end);
end;
$$;
revoke all on function public.search_my_participant_archive(text,jsonb,integer) from public, anon;
grant execute on function public.search_my_participant_archive(text,jsonb,integer) to authenticated;


create function public.search_my_archived_group_invitations(p_group_id uuid,p_search text default '',p_after jsonb default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  v_search text:=btrim(coalesce(p_search,''));
  v_limit integer:=least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean; v_name text;
begin
  if auth.uid() is null or not exists(select 1 from public.participant_group_invitations where group_id=p_group_id and created_by_user_id=auth.uid()) then
    raise exception using errcode='42501',message='participant group management denied';
  end if;
  select name into v_name from public.participant_groups where id=p_group_id;
  if v_name is null then raise exception using errcode='42501',message='participant group management denied'; end if;
  if length(v_search)>200 then raise exception using errcode='22023',message='invalid invitation search'; end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object' or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'group_id' is distinct from p_group_id::text or p_after->>'search' is distinct from v_search
      or nullif(p_after->>'id','') is null or nullif(p_after->>'created_at','') is null then
      raise exception using errcode='22023',message='invalid invitation cursor';
    end if;
    begin v_id:=(p_after->>'id')::uuid; v_date:=(p_after->>'created_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='invalid invitation cursor';
    end;
  end if;
  with page as (
    select id,email,status,expires_at,created_at,
      case when status='pending' and expires_at<=now() then 'expired' else status end display_status
    from public.participant_group_invitations
    where group_id=p_group_id and created_by_user_id=auth.uid()
      and (v_search='' or strpos(lower(email),lower(v_search))>0)
      and (p_after is null or (created_at,id)<(v_date,v_id))
    order by created_at desc,id desc limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id desc),'[]'::jsonb) into v_rows from page;
  v_more:=jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',v_name,'can_manage',false),
    'items',v_rows,'has_more',v_more,'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'group_id',p_group_id,'search',v_search,'id',v_last->>'id','created_at',v_last->>'created_at') else null end);
end;
$$;
revoke all on function public.search_my_archived_group_invitations(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.search_my_archived_group_invitations(uuid,text,jsonb,integer) to authenticated;
