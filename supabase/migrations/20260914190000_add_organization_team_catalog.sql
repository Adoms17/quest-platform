-- Каталоги команды: фиксированный состав полей, без токенов приглашений.
create index if not exists organization_team_catalog_idx on public.organization_memberships(organization_id,created_at desc,id desc);
create index if not exists organization_invitation_catalog_idx on public.organization_invitations(organization_id,created_at desc,id desc);
create function public.search_organization_team_catalog(
 p_organization_id uuid,p_kind text default 'members',p_search text default '',
 p_status text default 'all',p_after jsonb default null,p_limit integer default 25
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
 v_search text:=btrim(coalesce(p_search,''));
 v_limit integer:=least(greatest(coalesce(p_limit,25),1),50);
 v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean;
begin
 if p_kind is null or p_kind not in ('members','invitations') then
   raise exception using errcode='22023',message='invalid team catalog';
 end if;
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,
   case when p_kind='members' then 'members.read' else 'members.manage' end) then
   raise exception using errcode='42501',message='organization team catalog access denied';
 end if;
 if length(v_search)>200 or p_status is null
   or (p_kind='members' and p_status not in ('all','active','invited','suspended','revoked'))
   or (p_kind='invitations' and p_status not in ('all','pending','accepted','expired','revoked')) then
   raise exception using errcode='22023',message='invalid team filter';
 end if;
 if p_after is not null then
   if jsonb_typeof(p_after) is distinct from 'object'
     or p_after->>'actor_id' is distinct from auth.uid()::text
     or p_after->>'organization_id' is distinct from p_organization_id::text
     or p_after->>'kind' is distinct from p_kind or p_after->>'search' is distinct from v_search
     or p_after->>'status' is distinct from p_status
     or nullif(p_after->>'id','') is null or nullif(p_after->>'created_at','') is null then
     raise exception using errcode='22023',message='invalid team cursor';
   end if;
   begin
     v_id:=(p_after->>'id')::uuid; v_date:=(p_after->>'created_at')::timestamptz;
   exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
     raise exception using errcode='22023',message='invalid team cursor';
   end;
 end if;
 if p_kind='members' then
   with page as (
     select m.id,m.status,m.created_at,u.username,a.email::text email,
       coalesce((select jsonb_agg(jsonb_build_object('key',r.key,'name',r.name) order by r.name,r.key)
         from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'[]'::jsonb) roles
     from public.organization_memberships m join public.profiles u on u.id=m.user_id join auth.users a on a.id=m.user_id
     where m.organization_id=p_organization_id and (p_status='all' or m.status=p_status)
       and (v_search='' or strpos(lower(coalesce(u.username,'')),lower(v_search))>0 or strpos(lower(a.email::text),lower(v_search))>0)
       and (p_after is null or (m.created_at,m.id)<(v_date,v_id))
     order by m.created_at desc,m.id desc limit v_limit+1
   ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id desc),'[]'::jsonb) into v_rows from page;
 else
   with page as (
     select i.id,i.email,i.status,i.created_at,i.expires_at,
       case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end display_status,
       coalesce((select jsonb_agg(jsonb_build_object('key',r.key,'name',r.name) order by r.name,r.key)
         from public.organization_invitation_roles ir join public.roles r on r.id=ir.role_id where ir.invitation_id=i.id),'[]'::jsonb) roles
     from public.organization_invitations i
     where i.organization_id=p_organization_id
       and (p_status='all' or (case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end)=p_status)
       and (v_search='' or strpos(lower(i.email),lower(v_search))>0)
       and (p_after is null or (i.created_at,i.id)<(v_date,v_id))
     order by i.created_at desc,i.id desc limit v_limit+1
   ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id desc),'[]'::jsonb) into v_rows from page;
 end if;
 v_more:=jsonb_array_length(v_rows)>v_limit;
 if v_more then v_rows:=v_rows-v_limit; end if;
 v_last:=v_rows->(jsonb_array_length(v_rows)-1);
 return jsonb_build_object('organization_id',p_organization_id,'kind',p_kind,'status',p_status,'items',v_rows,'has_more',v_more,
   'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'organization_id',p_organization_id,'kind',p_kind,
     'search',v_search,'status',p_status,'created_at',v_last->>'created_at','id',v_last->>'id') else null end);
end; $$;
revoke all on function public.search_organization_team_catalog(uuid,text,text,text,jsonb,integer) from public,anon;
grant execute on function public.search_organization_team_catalog(uuid,text,text,text,jsonb,integer) to authenticated;
