begin;
alter table public.platform_audit_events drop constraint platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check
 check(action in ('assignment.created','assignment.updated','organization.summary.read','assignment.grant','assignment.revoke','support.open','support.close','organization.search'));

create function public.search_platform_organizations(p_search text default '',p_after uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare query_text text:=btrim(coalesce(p_search,'')); rows jsonb; next_cursor uuid; eligible uuid[];
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then
  raise exception 'platform access denied' using errcode='42501';
 end if;
 if p_limit is null or p_limit not between 1 and 100 or length(query_text)>160 then
  raise exception 'invalid platform search' using errcode='22023';
 end if;
 -- Только действующие назначения с нужным разрешением; scope не берётся от другой роли.
 select array_agg(a.id) into eligible from public.platform_access_assignments a
 join public.platform_role_permissions p on p.role_key=a.role_key and p.permission_key='organization.summary.read'
 where a.user_id=auth.uid() and a.revoked_at is null
 and a.valid_from<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp())
 and (a.scope_kind<>'support_case' or exists(select 1 from public.platform_support_cases c
   where c.id=a.support_case_id and c.organization_id=a.organization_id and c.closed_at is null));
 if eligible is null then raise exception 'platform access denied' using errcode='42501'; end if;
 -- UUID задаёт стабильный порядок и не требует общего COUNT. Поиск — буквальная подстрока.
 with candidates as (
  select o.id,o.name,o.created_at from public.organizations o
  where (p_after is null or o.id>p_after)
   and (query_text='' or strpos(lower(o.name),lower(query_text))>0 or o.id::text=query_text)
   and exists(select 1 from public.platform_access_assignments a where a.id=any(eligible)
    and (a.scope_kind='platform' or a.organization_id=o.id))
  order by o.id limit p_limit+1
 ), numbered as (select *,row_number() over(order by id) n from candidates)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at) order by id)
   filter(where n<=p_limit),'[]'::jsonb),
  case when count(*)>p_limit then (array_agg(id order by id))[p_limit] else null end
 into rows,next_cursor from numbered;
 -- Запрос поиска не журналируется: он может содержать персональные данные.
 insert into public.platform_audit_events(actor_id,action) values(auth.uid(),'organization.search');
 return jsonb_build_object('items',rows,'next_cursor',next_cursor);
end; $$;
revoke all on function public.search_platform_organizations(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_platform_organizations(text,uuid,integer) to authenticated;
commit;
