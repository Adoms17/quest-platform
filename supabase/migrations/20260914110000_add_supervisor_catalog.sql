-- Только разрешённые связи выбранного профиля, без загрузки остальных профилей.
create index if not exists supervisor_catalog_idx on public.participant_supervisions(participant_profile_id,supervisor_user_id);
create function public.search_participant_supervisors(p_participant_profile_id uuid,p_search text default '',p_after jsonb default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare
  v_manage boolean := public.can_manage_participant_supervisors(p_participant_profile_id);
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_id uuid; v_name text; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null or (not v_manage and not exists(select 1 from public.participant_supervisions where participant_profile_id=p_participant_profile_id and supervisor_user_id=auth.uid())) then
    raise exception using errcode='42501',message='participant supervision visibility denied';
  end if;
  if length(v_search)>200 then raise exception using errcode='22023',message='invalid supervisor search'; end if;
  if p_after is not null then
    if p_after->>'can_manage'='true' and not v_manage then
      raise exception using errcode='42501',message='participant supervision visibility denied';
    end if;
    if jsonb_typeof(p_after) is distinct from 'object' or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'profile_id' is distinct from p_participant_profile_id::text or p_after->>'search' is distinct from v_search
      or p_after->>'can_manage' is distinct from v_manage::text or p_after->>'name' is null or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023',message='invalid supervisor cursor';
    end if;
    begin v_id:=(p_after->>'id')::uuid; v_name:=p_after->>'name';
    exception when invalid_text_representation then raise exception using errcode='22023',message='invalid supervisor cursor'; end;
  end if;
  with page as (
    select s.supervisor_user_id id,coalesce(u.username,'') username,a.email::text email,s.status,
      s.supervisor_user_id=auth.uid() is_self
    from public.participant_supervisions s join public.profiles u on u.id=s.supervisor_user_id join auth.users a on a.id=s.supervisor_user_id
    where s.participant_profile_id=p_participant_profile_id and (v_manage or s.supervisor_user_id=auth.uid())
      and (v_search='' or strpos(lower(coalesce(u.username,'')||' '||coalesce(a.email,'')),lower(v_search))>0)
      and (p_after is null or (lower(coalesce(u.username,'')),s.supervisor_user_id)>(v_name,v_id))
    order by lower(coalesce(u.username,'')),s.supervisor_user_id limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by lower(username),id),'[]'::jsonb) into v_rows from page;
  v_more:=jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('profile_id',p_participant_profile_id,'can_manage',v_manage,'items',v_rows,'has_more',v_more,'next_cursor',case when v_more then
    jsonb_build_object('actor_id',auth.uid(),'profile_id',p_participant_profile_id,'can_manage',v_manage,'search',v_search,'name',lower(v_last->>'username'),'id',v_last->>'id') else null end);
end;
$$;
revoke all on function public.search_participant_supervisors(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.search_participant_supervisors(uuid,text,jsonb,integer) to authenticated;
