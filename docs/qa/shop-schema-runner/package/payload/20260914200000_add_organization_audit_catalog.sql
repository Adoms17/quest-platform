create index if not exists organization_audit_catalog_idx on public.organization_audit_events(organization_id,created_at desc,id desc);
create function public.search_organization_audit(p_organization_id uuid,p_category text default 'all',p_after jsonb default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
 v_limit integer:=least(greatest(coalesce(p_limit,25),1),50);
 v_date timestamptz; v_id bigint; v_rows jsonb; v_last jsonb; v_more boolean; v_participants boolean;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'members.manage') then
   raise exception using errcode='42501',message='organization audit access denied';
 end if;
 if p_category is null or p_category not in ('all','team','quest_access') then
   raise exception using errcode='22023',message='invalid audit category';
 end if;
 v_participants:=public.has_organization_permission(p_organization_id,'participants.read');
 if p_after is not null then
   if jsonb_typeof(p_after) is distinct from 'object'
     or p_after->>'actor_id' is distinct from auth.uid()::text
     or p_after->>'organization_id' is distinct from p_organization_id::text
     or p_after->>'category' is distinct from p_category
     or nullif(p_after->>'id','') is null or nullif(p_after->>'created_at','') is null then
     raise exception using errcode='22023',message='invalid audit cursor';
   end if;
   begin
     v_id:=(p_after->>'id')::bigint; v_date:=(p_after->>'created_at')::timestamptz;
   exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
     raise exception using errcode='22023',message='invalid audit cursor';
   end;
 end if;
 with page as (
   select e.id::text id,e.created_at,e.action,u.username actor_username,
     case when v_participants then p.display_name else null end participant_display_name
   from public.organization_audit_events e
   left join public.profiles u on u.id=e.actor_user_id
   left join public.participant_profiles p on p.id=e.participant_profile_id
   where e.organization_id=p_organization_id
     and (p_category='all' or (p_category='team' and (e.action like 'invitation.%' or e.action like 'membership.%'))
       or (p_category='quest_access' and e.action like 'quest_access.%'))
     and (p_after is null or (e.created_at,e.id)<(v_date,v_id))
   order by e.created_at desc,e.id desc limit v_limit+1
 ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id::bigint desc),'[]'::jsonb) into v_rows from page;
 v_more:=jsonb_array_length(v_rows)>v_limit;
 if v_more then v_rows:=v_rows-v_limit; end if;
 v_last:=v_rows->(jsonb_array_length(v_rows)-1);
 return jsonb_build_object('organization_id',p_organization_id,'category',p_category,'items',v_rows,'has_more',v_more,
   'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'organization_id',p_organization_id,'category',p_category,
     'created_at',v_last->>'created_at','id',v_last->>'id') else null end);
end; $$;
revoke all on function public.search_organization_audit(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.search_organization_audit(uuid,text,jsonb,integer) to authenticated;
