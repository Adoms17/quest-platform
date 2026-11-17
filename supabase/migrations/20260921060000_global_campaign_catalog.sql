begin;
-- Существующая связь сохранена только как происхождение ранних локальных записей.
alter table public.platform_discount_campaigns alter column organization_id drop not null;
alter table public.platform_campaign_read_events alter column organization_id drop not null;
alter table public.billing_discount_codes drop constraint billing_discount_codes_campaign_id_key;
create unique index billing_discount_campaign_organization_idx on public.billing_discount_codes(campaign_id,organization_id);
create index platform_campaign_created_idx on public.platform_discount_campaigns(created_at desc,id desc);
create function platform_private.require_campaign_catalog_access() returns uuid
language plpgsql security definer set search_path='' as $$
declare assignment uuid;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'platform access denied' using errcode='42501'; end if;
 select a.id into assignment from public.platform_access_assignments a
 join public.platform_role_permissions p on p.role_key=a.role_key and p.permission_key='billing.campaign.draft'
 where a.user_id=auth.uid() and a.scope_kind='platform' and a.revoked_at is null
 and a.valid_from<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp()) order by a.id limit 1;
 if assignment is null then raise exception 'platform access denied' using errcode='42501'; end if;
 return assignment;
end; $$;
revoke all on function platform_private.require_campaign_catalog_access() from public,anon,authenticated,service_role;
create or replace function public.save_platform_discount_campaign(p_command_id uuid,p_id uuid,p_organization_id uuid,p_expected_revision integer,
 p_title text,p_plan_key text,p_discount_bps integer,p_eligible_periods integer,p_period_months integer,p_activate_before timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; receipt public.platform_discount_campaign_commands%rowtype; draft public.platform_discount_campaigns%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock(18092026,1);
 -- Редактирование отделено от чтения, область берётся из того же назначения.
 perform platform_private.require_campaign_catalog_access();
 if p_command_id is null or p_id is null or p_expected_revision is null or p_expected_revision<0
 or p_title is null or length(btrim(p_title)) not between 1 and 120
 or p_plan_key is null or p_plan_key='free' or not exists(select 1 from public.billing_plan_versions where plan_key=p_plan_key)
 or p_discount_bps is null or p_discount_bps not between 1 and 10000
 or p_eligible_periods is null or p_eligible_periods<1 or p_period_months is null or p_period_months<1
 or p_activate_before is null or not isfinite(p_activate_before) then raise exception 'invalid campaign' using errcode='22023'; end if;
 payload:=jsonb_build_object('operation','save','id',p_id,'organization',p_organization_id,'revision',p_expected_revision,'title',btrim(p_title),
 'plan',p_plan_key,'bps',p_discount_bps,'periods',p_eligible_periods,'months',p_period_months,'deadline',p_activate_before);
 select * into receipt from public.platform_discount_campaign_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then raise exception 'campaign command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 if p_activate_before<=clock_timestamp() then raise exception 'campaign deadline expired' using errcode='22023'; end if;
 select * into draft from public.platform_discount_campaigns where id=p_id for update;
 if found then

 if draft.state<>'draft' then raise exception 'approved campaign immutable' using errcode='55000'; end if;
 if draft.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 update public.platform_discount_campaigns set title=btrim(p_title),plan_key=p_plan_key,discount_bps=p_discount_bps,
 eligible_periods=p_eligible_periods,period_months=p_period_months,activate_before=p_activate_before,
 revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into draft;
 else
 if p_expected_revision<>0 then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 insert into public.platform_discount_campaigns(id,organization_id,title,plan_key,discount_bps,eligible_periods,period_months,activate_before)
 values(p_id,null,btrim(p_title),p_plan_key,p_discount_bps,p_eligible_periods,p_period_months,p_activate_before) returning * into draft;
 end if;
 result:=to_jsonb(draft);
 insert into public.platform_discount_campaign_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,result);
 return result;
end; $$;
revoke all on function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz) to authenticated;


create or replace function public.read_platform_discount_campaigns(p_organization_id uuid,p_after uuid default null,p_id uuid default null,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; cursor_time timestamptz; result jsonb; actual_revision integer;
begin
 if p_organization_id is null then assignment:=platform_private.require_campaign_catalog_access(); else assignment:=public.require_platform_permission('billing.campaign.issue',p_organization_id); end if;
 if p_organization_id is not null and not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 if (p_id is not null and p_after is not null) or (p_expected_revision is not null and p_id is null) then raise exception 'invalid campaign query' using errcode='22023'; end if;
 if p_id is not null then
  select revision into actual_revision from public.platform_discount_campaigns where id=p_id and (p_organization_id is null or state='approved') for share;
  if not found then raise exception 'campaign unavailable' using errcode='22023'; end if;
  if p_expected_revision is not null and p_expected_revision<>actual_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 end if;
 if p_after is not null then
  select created_at into cursor_time from public.platform_discount_campaigns where id=p_after and (p_organization_id is null or state='approved');
  if not found then raise exception 'invalid campaign cursor' using errcode='22023'; end if;
 end if;
 with candidates as (
  select id,title,plan_key,discount_bps,eligible_periods,period_months,activate_before,revision,state,approved_at,created_at,updated_at,
   activate_before<=statement_timestamp() activation_expired
  from public.platform_discount_campaigns
  where (p_organization_id is null or state='approved') and (p_id is null or id=p_id)
   and (p_after is null or (created_at,id)<(cursor_time,p_after))
  order by created_at desc,id desc limit 26
 ), numbered as (select *,row_number() over(order by created_at desc,id desc) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(c)-'n' order by created_at desc,id desc) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by created_at desc,id desc))[25] else null end)
 into result from numbered c;
 insert into public.platform_campaign_read_events(actor_id,assignment_id,organization_id,campaign_id) values(auth.uid(),assignment,p_organization_id,p_id);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.campaign.draft','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.read_platform_discount_campaigns(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_discount_campaigns(uuid,uuid,uuid,integer) to authenticated;


create or replace function public.issue_platform_campaign_discount(p_organization_id uuid,p_campaign_id uuid,p_expected_revision integer,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.platform_discount_campaigns%rowtype; existing public.billing_discount_codes%rowtype; raw_code text;
begin
 perform pg_advisory_xact_lock(18092026,1);
 perform public.require_platform_permission('billing.campaign.issue',p_organization_id);
 if p_campaign_id is null or p_expected_revision is null or p_command_id is null then raise exception 'invalid campaign issue' using errcode='22023'; end if;
 select * into campaign from public.platform_discount_campaigns where id=p_campaign_id for update;
 if not found then raise exception 'campaign unavailable' using errcode='22023'; end if;
 if campaign.state<>'approved' then raise exception 'campaign not approved' using errcode='55000'; end if;
 if campaign.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 select * into existing from public.billing_discount_codes where issuer_id=auth.uid() and issue_command_id=p_command_id;
 if found and (existing.campaign_id is distinct from campaign.id or existing.organization_id is distinct from p_organization_id) then raise exception 'discount command conflict' using errcode='22023'; end if;
 select * into existing from public.billing_discount_codes where campaign_id=campaign.id and organization_id=p_organization_id;
 if found then return jsonb_build_object('discount_id',existing.id,'already_issued',true,'code',null); end if;
 if campaign.activate_before<=clock_timestamp() then raise exception 'discount activation deadline expired' using errcode='22023'; end if;
 raw_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
 insert into public.billing_discount_codes(organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id,campaign_id)
 values(p_organization_id,campaign.plan_key,encode(extensions.digest(raw_code,'sha256'),'hex'),campaign.discount_bps,campaign.eligible_periods,campaign.period_months,campaign.activate_before,auth.uid(),p_command_id,campaign.id)
 returning * into existing;
 return jsonb_build_object('discount_id',existing.id,'already_issued',false,'code',raw_code);
end; $$;
revoke all on function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid) to authenticated;
commit;
