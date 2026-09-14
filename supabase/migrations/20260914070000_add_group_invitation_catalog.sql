create index if not exists group_invitation_catalog_idx on public.participant_group_invitations(group_id,created_by_user_id,created_at desc,id desc);
create function public.search_my_group_invitations(p_group_id uuid,p_search text default '',p_after jsonb default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  v_search text:=btrim(coalesce(p_search,''));
  v_limit integer:=least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean; v_name text;
begin
  if auth.uid() is null or not public.can_manage_participant_group(p_group_id) then
    raise exception using errcode='42501',message='participant group management denied';
  end if;
  select name into v_name from public.participant_groups where id=p_group_id and status='active';
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
  return jsonb_build_object('group',jsonb_build_object('id',p_group_id,'name',v_name,'can_manage',true),
    'items',v_rows,'has_more',v_more,'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'group_id',p_group_id,'search',v_search,'id',v_last->>'id','created_at',v_last->>'created_at') else null end);
end;
$$;
revoke all on function public.search_my_group_invitations(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.search_my_group_invitations(uuid,text,jsonb,integer) to authenticated;
