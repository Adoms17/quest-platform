begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read','billing.campaign.draft','billing.campaign.issue','billing.payment.read','billing.refund.preview','organization.quests.read'));
insert into public.platform_role_permissions values ('owner','organization.quests.read'),('operations','organization.quests.read');
alter table public.platform_audit_events drop constraint platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check
 check(action in ('assignment.created','assignment.updated','organization.summary.read','assignment.grant','assignment.revoke','support.open','support.close','organization.search','organization.quests.read'));
create function public.read_platform_organization_quests(p_organization_id uuid,p_search text default '',p_status text default 'all',p_after jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; query_text text:=btrim(coalesce(p_search,'')); rows jsonb; cursor_time timestamptz; cursor_id uuid; totals jsonb;
begin
 assignment:=public.require_platform_permission('organization.quests.read',p_organization_id);
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 if length(query_text)>200 or p_status is null or p_status not in ('all','open','closed') then raise exception 'invalid quest filter' using errcode='22023'; end if;
 if p_after is not null then
  if jsonb_typeof(p_after) is distinct from 'object' or p_after->>'organization_id' is distinct from p_organization_id::text
   or p_after->>'search' is distinct from query_text or p_after->>'status' is distinct from p_status
   or nullif(p_after->>'created_at','') is null or nullif(p_after->>'id','') is null then raise exception 'invalid quest cursor' using errcode='22023'; end if;
  cursor_time:=(p_after->>'created_at')::timestamptz; cursor_id:=(p_after->>'id')::uuid;
 end if;
 select jsonb_build_object('total',count(*),'open',count(*) filter(where coalesce(is_open,false)),'closed',count(*) filter(where not coalesce(is_open,false)))
 into totals from public.quests where organization_id=p_organization_id;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into rows from (
  select id,title,coalesce(is_open,false) is_open,coalesce(is_public,false) is_public,
   coalesce(created_at,'-infinity'::timestamptz) created_at,start_at,end_at
  from public.quests where organization_id=p_organization_id
   and (query_text='' or strpos(lower(title),lower(query_text))>0)
   and (p_status='all' or coalesce(is_open,false)=(p_status='open'))
   and (p_after is null or (coalesce(created_at,'-infinity'::timestamptz),id)<(cursor_time,cursor_id))
  order by coalesce(created_at,'-infinity'::timestamptz) desc,id desc limit 26
 )q;
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action)
 values(auth.uid(),assignment,p_organization_id,'organization.quests.read');
 return jsonb_build_object('summary',totals,'items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
  'next_cursor',case when jsonb_array_length(rows)>25 then jsonb_build_object('organization_id',p_organization_id,'search',query_text,'status',p_status,'created_at',rows->24->'created_at','id',rows->24->'id') else null end);
end; $$;
revoke all on function public.read_platform_organization_quests(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_organization_quests(uuid,text,text,jsonb) to authenticated;
commit;