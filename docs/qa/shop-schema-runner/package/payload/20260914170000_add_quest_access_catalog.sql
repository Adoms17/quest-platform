-- Серверные списки доступа. Секреты и хеши не возвращаются.
create function public.search_quest_access_catalog(p_quest_id uuid,p_kind text default 'credentials',p_search text default '',p_after jsonb default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  v_search text:=btrim(coalesce(p_search,''));
  v_limit integer:=least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null or not public.has_quest_permission(p_quest_id,'access_grants.manage') then
    raise exception using errcode='42501',message='quest access management denied';
  end if;
  if p_kind is null or p_kind not in ('credentials','grants') then raise exception using errcode='22023',message='invalid access catalog'; end if;
  if length(v_search)>200 then raise exception using errcode='22023',message='invalid invitation search'; end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object' or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'kind' is distinct from p_kind
      or p_after->>'quest_id' is distinct from p_quest_id::text or p_after->>'search' is distinct from v_search
      or nullif(p_after->>'id','') is null or nullif(p_after->>'created_at','') is null then
      raise exception using errcode='22023',message='invalid invitation cursor';
    end if;
    begin v_id:=(p_after->>'id')::uuid; v_date:=(p_after->>'created_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='invalid invitation cursor';
    end;
  end if;
  if p_kind='credentials' then
    with page as (
      select id,kind,email,status,max_redemptions,redemption_count,expires_at,created_at,
        case when status='active' and expires_at<=now() then 'expired' else status end display_status
      from public.quest_access_credentials
      where quest_id=p_quest_id and (v_search='' or strpos(lower(coalesce(email,'')),lower(v_search))>0)
        and (p_after is null or (created_at,id)<(v_date,v_id))
      order by created_at desc,id desc limit v_limit+1
    ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id desc),'[]'::jsonb) into v_rows from page;
  else
    with page as (
      select g.id,g.user_id,p.display_name participant_display_name,u.username,a.email::text email,
        g.status,g.expires_at,g.granted_at created_at,c.kind credential_kind,
        case when g.status='active' and g.expires_at<=now() then 'expired' else g.status end display_status
      from public.quest_access_grants g
      join public.participant_profiles p on p.id=g.participant_profile_id
      join public.profiles u on u.id=g.user_id
      join auth.users a on a.id=g.user_id
      left join public.quest_access_credentials c on c.id=g.credential_id
      where g.quest_id=p_quest_id and (v_search='' or strpos(lower(p.display_name||' '||coalesce(u.username,'')||' '||coalesce(a.email,'')),lower(v_search))>0)
        and (p_after is null or (g.granted_at,g.id)<(v_date,v_id))
      order by g.granted_at desc,g.id desc limit v_limit+1
    ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id desc),'[]'::jsonb) into v_rows from page;
  end if;
  v_more:=jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('quest_id',p_quest_id,'kind',p_kind,
    'items',v_rows,'has_more',v_more,'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'kind',p_kind,'quest_id',p_quest_id,'search',v_search,'id',v_last->>'id','created_at',v_last->>'created_at') else null end);
end;
$$;
revoke all on function public.search_quest_access_catalog(uuid,text,text,jsonb,integer) from public,anon;
grant execute on function public.search_quest_access_catalog(uuid,text,text,jsonb,integer) to authenticated;
