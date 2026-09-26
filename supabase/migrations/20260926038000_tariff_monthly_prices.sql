begin;
-- Initial public prices approved by owner; sandbox offers are independent.
alter table public.billing_plan_versions add column monthly_price_minor integer;
alter table public.platform_fixed_tariff_versions add column monthly_price_minor integer;
alter table public.platform_tariff_drafts add column monthly_price_minor integer;
alter table public.billing_plan_versions disable trigger billing_plan_versions_immutable;
update public.billing_plan_versions set monthly_price_minor=case plan_key when 'free' then 0 when 'pro' then 99000 when 'business' then 249000 end;
alter table public.billing_plan_versions enable trigger billing_plan_versions_immutable;
alter table public.platform_fixed_tariff_versions disable trigger platform_fixed_tariffs_immutable;
update public.platform_fixed_tariff_versions set monthly_price_minor=case plan_key when 'free' then 0 when 'pro' then 99000 when 'business' then 249000 end;
alter table public.platform_fixed_tariff_versions enable trigger platform_fixed_tariffs_immutable;
alter table public.platform_tariff_drafts disable trigger published_tariff_draft_guard;
update public.platform_tariff_drafts d set monthly_price_minor=p.monthly_price_minor from public.billing_plan_versions p where p.id=d.source_version_id;
alter table public.platform_tariff_drafts enable trigger published_tariff_draft_guard;
alter table public.billing_plan_versions add constraint plan_monthly_price_valid check(monthly_price_minor is null or (monthly_price_minor>=0 and (plan_key<>'free' or monthly_price_minor=0)));
alter table public.platform_fixed_tariff_versions add constraint fixed_monthly_price_valid check(monthly_price_minor is null or (monthly_price_minor>=0 and (plan_key<>'free' or monthly_price_minor=0)));
alter table public.platform_tariff_drafts add constraint draft_monthly_price_valid check(monthly_price_minor>=0);
drop function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer,text);
create function public.save_platform_tariff_draft(p_command_id uuid,p_id uuid,p_source_version_id uuid,
 p_expected_revision integer,p_display_name text,p_active_quests_limit integer,p_team_members_limit integer,p_trial_duration_days integer,p_description text default null,p_monthly_price_minor integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; receipt public.platform_tariff_draft_commands%rowtype;
 draft public.platform_tariff_drafts%rowtype; result jsonb;
begin
 -- Та же блокировка, что у изменения назначений: отзыв не обгоняет команду.
 perform pg_catalog.pg_advisory_xact_lock(18092026,1);
 perform public.require_platform_tariff_draft_access();
 -- Older clients preserve an existing draft price or inherit their source version.
 p_monthly_price_minor:=coalesce(p_monthly_price_minor,
 (select monthly_price_minor from public.platform_tariff_drafts where id=p_id),
 (select monthly_price_minor from public.billing_plan_versions where id=p_source_version_id));
 if p_command_id is null or p_id is null or p_source_version_id is null
 or p_monthly_price_minor is null or p_monthly_price_minor<0
 or p_expected_revision is null or p_expected_revision<0
 or p_display_name is null or length(btrim(p_display_name)) not between 1 and 80
 or p_active_quests_limit is null or p_active_quests_limit<0
 or p_team_members_limit is null or p_team_members_limit<1
 or p_trial_duration_days is null or p_trial_duration_days<1 or length(p_description)>500 then
 raise exception 'invalid tariff draft' using errcode='22023'; end if;
 if exists(select 1 from public.billing_plan_versions where id=p_source_version_id and plan_key='free') and p_monthly_price_minor<>0 then raise exception 'Free price must be zero' using errcode='22023'; end if;
 payload:=jsonb_build_object('monthly_price_minor',p_monthly_price_minor,'id',p_id,'source',p_source_version_id,'revision',p_expected_revision,
 'name',p_display_name,'quests',p_active_quests_limit,'team',p_team_members_limit,'trial',p_trial_duration_days);
 if p_description is not null then payload:=payload||jsonb_build_object('description',p_description); end if;
 select * into receipt from public.platform_tariff_draft_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then
 raise exception 'command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 select * into draft from public.platform_tariff_drafts where id=p_id for update;
 if found then
 if draft.revision<>p_expected_revision or draft.source_version_id<>p_source_version_id then
 raise exception 'draft revision conflict' using errcode='40001'; end if;
 update public.platform_tariff_drafts set monthly_price_minor=p_monthly_price_minor,display_name=btrim(p_display_name),active_quests_limit=p_active_quests_limit,
 team_members_limit=p_team_members_limit,trial_duration_days=p_trial_duration_days,
 description=coalesce(p_description,description),revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into draft;
 else
 if p_expected_revision<>0 then raise exception 'draft revision conflict' using errcode='40001'; end if;
 if not exists(select 1 from public.billing_plan_versions where id=p_source_version_id) then
 raise exception 'unknown source version' using errcode='22023'; end if;
 insert into public.platform_tariff_drafts(id,source_version_id,display_name,active_quests_limit,team_members_limit,trial_duration_days,description,monthly_price_minor)
 values(p_id,p_source_version_id,btrim(p_display_name),p_active_quests_limit,p_team_members_limit,p_trial_duration_days,coalesce(p_description,''),p_monthly_price_minor)
 returning * into draft;
 end if;
 result:=to_jsonb(draft);
 insert into public.platform_tariff_draft_commands(command_id,actor_id,request,result)
 values(p_command_id,auth.uid(),payload,result);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),
 'action','billing.draft.save','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer,text,integer) to authenticated;

do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.publish_tariff_draft(uuid,uuid,integer,timestamptz)'::regprocedure);
 if position('trial_duration_days,actor_id,command_id)' in definition)=0 or position('trial_duration_days,created_at)' in definition)=0 then raise exception 'publication price marker missing'; end if;
 definition:=replace(definition,'trial_duration_days,actor_id,command_id)','trial_duration_days,monthly_price_minor,actor_id,command_id)');
 definition:=replace(definition,'draft.trial_duration_days,auth.uid()','draft.trial_duration_days,draft.monthly_price_minor,auth.uid()');
 definition:=replace(definition,'trial_duration_days,created_at)','trial_duration_days,created_at,monthly_price_minor)');
 definition:=replace(definition,'select id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at','select id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at,monthly_price_minor');
 definition:=replace(definition,'select * into source from public.billing_plan_versions',
 'if draft.monthly_price_minor is null then raise exception ''tariff price required'' using errcode=''22023''; end if;
 select * into source from public.billing_plan_versions');
 execute definition;
 definition:=pg_get_functiondef('public.preview_platform_tariff_draft(uuid,integer)'::regprocedure);
 if position('''changes'',jsonb_build_object(' in definition)=0 then raise exception 'preview marker missing'; end if;
 execute replace(definition,'''changes'',jsonb_build_object(','''changes'',jsonb_build_object(''monthly_price_minor'',draft.monthly_price_minor is distinct from source.monthly_price_minor,');
end; $$;

create or replace function public.read_platform_tariff_catalog(p_after uuid default null,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
 result:=public.read_platform_tariff_catalog_before_timeline(p_after,p_id);
 select coalesce(jsonb_agg(value||jsonb_build_object('monthly_price_minor',(select p.monthly_price_minor from public.billing_plan_versions p where p.id=(value->>'id')::uuid),'timeline_number',platform_private.tariff_timeline_number((value->>'id')::uuid),
 'timeline_state',platform_private.tariff_version_state((value->>'id')::uuid,statement_timestamp()),
 'effective_at',(select t.effective_at from public.billing_tariff_timeline t where t.version_id=(value->>'id')::uuid),
 'source_version',(select jsonb_build_object('id',b.id,'display_name',b.display_name,'timeline_number',platform_private.tariff_timeline_number(b.id))
 from public.platform_fixed_tariff_versions f join public.platform_tariff_drafts d on d.id=f.draft_id
 join public.billing_plan_versions b on b.id=d.source_version_id where f.id=(value->>'id')::uuid)) order by ord),'[]'::jsonb)
 into items from jsonb_array_elements(result->'items') with ordinality x(value,ord);
 return jsonb_set(result,'{items}',items);
end; $$;
revoke all on function public.read_platform_tariff_catalog(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_platform_tariff_catalog(uuid,uuid) to authenticated;


-- Only effective public terms. No caller-supplied clock or private fields.
create function public.read_public_tariff_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('as_of',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'plan_key',p.plan_key,'display_name',p.display_name,'monthly_price_minor',p.monthly_price_minor,
 'currency','RUB','billing_period','month','active_quests_limit',p.active_quests_limit,
 'team_members_limit',p.team_members_limit,'trial_duration_days',case when p.plan_key='free' then 0 else p.trial_duration_days end,
 'effective_at',t.effective_at) order by keys.ordinality),'[]'::jsonb))
 from unnest(array['free','pro','business']) with ordinality keys(plan_key,ordinality)
 join public.billing_plan_versions p on p.id=platform_private.current_tariff_version(keys.plan_key,statement_timestamp())
 join public.billing_tariff_timeline t on t.version_id=p.id where p.monthly_price_minor is not null;
$$;
revoke all on function public.read_public_tariff_catalog() from public,anon,authenticated,service_role;
grant execute on function public.read_public_tariff_catalog() to anon,authenticated;
commit;
