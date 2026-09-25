begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read','billing.campaign.draft','billing.campaign.issue','billing.payment.read','billing.refund.preview','organization.quests.read','organization.participants.read'));
insert into public.platform_role_permissions values ('owner','organization.participants.read'),('operations','organization.participants.read');
alter table public.platform_audit_events drop constraint platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check
 check(action in ('assignment.created','assignment.updated','organization.summary.read','assignment.grant','assignment.revoke','support.open','support.close','organization.search','organization.quests.read','organization.participants.read'));
-- Scope is participation, never membership of the organization or ownership of a group.
-- Group membership is current; it is not a historical snapshot at the time of a quest.
create function public.read_platform_organization_participants(
 p_organization_id uuid,p_kind text default 'profiles',p_search text default '',
 p_group_id uuid default null,p_profile_id uuid default null,p_after jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; query_text text:=btrim(coalesce(p_search,'')); rows jsonb; cursor_name text; cursor_id uuid;
begin
 assignment:=public.require_platform_permission('organization.participants.read',p_organization_id);
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 if length(query_text)>200 or p_kind is null or p_kind not in ('profiles','groups')
  or (p_kind='profiles' and p_profile_id is not null) or (p_kind='groups' and p_group_id is not null)
 then raise exception 'invalid participant filter' using errcode='22023'; end if;
 if p_after is not null then
  if jsonb_typeof(p_after) is distinct from 'object'
   or p_after->>'organization_id' is distinct from p_organization_id::text
   or p_after->>'kind' is distinct from p_kind or p_after->>'search' is distinct from query_text
   or p_after->>'group_id' is distinct from p_group_id::text
   or p_after->>'profile_id' is distinct from p_profile_id::text
   or jsonb_typeof(p_after->'name') is distinct from 'string' or nullif(p_after->>'id','') is null
  then raise exception 'invalid participant cursor' using errcode='22023'; end if;
  cursor_name:=p_after->>'name';
  begin cursor_id:=(p_after->>'id')::uuid;
  exception when invalid_text_representation then raise exception 'invalid participant cursor' using errcode='22023'; end;
 end if;
 with participating as materialized (
  select distinct a.participant_profile_id id
  from public.quest_attempts a join public.quests q on q.id=a.quest_id where q.organization_id=p_organization_id
 ), visible_profiles as materialized (
  select p.id,p.display_name,p.age_group,p.status from public.participant_profiles p join participating x on x.id=p.id
 ), candidates as (
  select p.id,p.display_name name,lower(p.display_name) sort_name,
   jsonb_build_object('id',p.id,'name',p.display_name,'age_group',p.age_group,'status',p.status) item
  from visible_profiles p where p_kind='profiles' and (p_group_id is null or exists(
   select 1 from public.participant_group_members m join public.participant_groups g on g.id=m.group_id
   where m.participant_profile_id=p.id and m.group_id=p_group_id and m.status='active' and g.status='active'))
  union all
  select g.id,g.name,lower(g.name),jsonb_build_object('id',g.id,'name',g.name)
  from public.participant_groups g where p_kind='groups' and g.status='active' and exists(
   select 1 from public.participant_group_members m join visible_profiles p on p.id=m.participant_profile_id
   where m.group_id=g.id and m.status='active' and (p_profile_id is null or p.id=p_profile_id))
 ), page as (
  select * from candidates where (query_text='' or strpos(lower(name),lower(query_text))>0)
   and (p_after is null or (sort_name,id)>(cursor_name,cursor_id)) order by sort_name,id limit 26
 ) select coalesce(jsonb_agg(item order by sort_name,id),'[]'::jsonb) into rows from page;
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action)
 values(auth.uid(),assignment,p_organization_id,'organization.participants.read');
 return jsonb_build_object('items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
  'next_cursor',case when jsonb_array_length(rows)>25 then jsonb_build_object('organization_id',p_organization_id,
   'kind',p_kind,'search',query_text,'group_id',p_group_id,'profile_id',p_profile_id,
   'name',lower(rows->24->>'name'),'id',rows->24->'id') else null end);
end; $$;
revoke all on function public.read_platform_organization_participants(uuid,text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_organization_participants(uuid,text,text,uuid,uuid,jsonb) to authenticated;
commit;

