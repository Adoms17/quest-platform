begin;
alter table public.platform_discount_campaigns add column starts_at timestamptz not null default '1970-01-01 UTC';
alter table public.platform_discount_campaigns add constraint campaign_dates check(isfinite(starts_at) and starts_at<activate_before);
alter table public.billing_discount_codes add column activate_from timestamptz not null default '1970-01-01 UTC';
alter table public.billing_discount_codes add constraint discount_activation_dates check(isfinite(activate_from) and activate_from<activate_before);
create or replace function platform_private.protect_discount_campaign() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or exists(select 1 from public.billing_discount_codes where campaign_id=old.id) then raise exception 'issued campaign immutable' using errcode='55000'; end if;
 return new;
end; $$;
drop function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz);
drop function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid);
create or replace function public.save_platform_discount_campaign(p_command_id uuid,p_id uuid,p_organization_id uuid,p_expected_revision integer,
 p_title text,p_plan_key text,p_discount_bps integer,p_eligible_periods integer,p_period_months integer,p_activate_before timestamptz,p_starts_at timestamptz default '1970-01-01 UTC')
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
 or p_starts_at is null or not isfinite(p_starts_at) or p_starts_at>=p_activate_before or p_activate_before is null or not isfinite(p_activate_before) then raise exception 'invalid campaign' using errcode='22023'; end if;
 payload:=jsonb_build_object('operation','save','id',p_id,'organization',p_organization_id,'revision',p_expected_revision,'title',btrim(p_title),
 'plan',p_plan_key,'bps',p_discount_bps,'periods',p_eligible_periods,'months',p_period_months,'deadline',p_activate_before,'starts_at',p_starts_at);
 select * into receipt from public.platform_discount_campaign_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then raise exception 'campaign command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 if p_activate_before<=clock_timestamp() then raise exception 'campaign deadline expired' using errcode='22023'; end if;
 select * into draft from public.platform_discount_campaigns where id=p_id for update;
 if found then

 if exists(select 1 from public.billing_discount_codes where campaign_id=p_id) then raise exception 'issued campaign immutable' using errcode='55000'; end if;
 if draft.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 update public.platform_discount_campaigns set title=btrim(p_title),plan_key=p_plan_key,discount_bps=p_discount_bps,
 eligible_periods=p_eligible_periods,period_months=p_period_months,activate_before=p_activate_before,
 starts_at=p_starts_at,state='draft',approved_by=null,approved_at=null,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into draft;
 else
 if p_expected_revision<>0 then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 insert into public.platform_discount_campaigns(id,organization_id,title,plan_key,discount_bps,eligible_periods,period_months,activate_before,starts_at)
 values(p_id,null,btrim(p_title),p_plan_key,p_discount_bps,p_eligible_periods,p_period_months,p_activate_before,p_starts_at) returning * into draft;
 end if;
 result:=to_jsonb(draft);
 insert into public.platform_discount_campaign_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,result);
 return result;
end; $$;
revoke all on function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz,timestamptz) to authenticated;


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
  select starts_at,exists(select 1 from public.billing_discount_codes d where d.campaign_id=platform_discount_campaigns.id) has_issued_codes,id,title,plan_key,discount_bps,eligible_periods,period_months,activate_before,revision,state,approved_at,created_at,updated_at,
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


create or replace function public.issue_platform_campaign_discount(p_organization_id uuid,p_campaign_id uuid,p_expected_revision integer,p_command_id uuid,p_activate_before timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.platform_discount_campaigns%rowtype; existing public.billing_discount_codes%rowtype; raw_code text; deadline timestamptz;
begin
 perform pg_advisory_xact_lock(18092026,1);
 perform public.require_platform_permission('billing.campaign.issue',p_organization_id);
 if p_campaign_id is null or p_expected_revision is null or p_command_id is null then raise exception 'invalid campaign issue' using errcode='22023'; end if;
 select * into campaign from public.platform_discount_campaigns where id=p_campaign_id for update;
 if not found then raise exception 'campaign unavailable' using errcode='22023'; end if;
 deadline:=coalesce(p_activate_before,campaign.activate_before);
 if not isfinite(deadline) or deadline>campaign.activate_before or deadline<=campaign.starts_at then raise exception 'invalid activation window' using errcode='22023'; end if;
 if campaign.state<>'approved' then raise exception 'campaign not approved' using errcode='55000'; end if;
 if campaign.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 select * into existing from public.billing_discount_codes where issuer_id=auth.uid() and issue_command_id=p_command_id;
 if found and (existing.campaign_id is distinct from campaign.id or existing.organization_id is distinct from p_organization_id or existing.activate_before is distinct from deadline) then raise exception 'discount command conflict' using errcode='22023'; end if;
 select * into existing from public.billing_discount_codes where campaign_id=campaign.id and organization_id=p_organization_id;
 if found then return jsonb_build_object('discount_id',existing.id,'already_issued',true,'code',null); end if;
 if deadline<=clock_timestamp() then raise exception 'discount activation deadline expired' using errcode='22023'; end if;
 raw_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
 insert into public.billing_discount_codes(organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id,campaign_id,activate_from)
 values(p_organization_id,campaign.plan_key,encode(extensions.digest(raw_code,'sha256'),'hex'),campaign.discount_bps,campaign.eligible_periods,campaign.period_months,deadline,auth.uid(),p_command_id,campaign.id,campaign.starts_at)
 returning * into existing;
 return jsonb_build_object('discount_id',existing.id,'already_issued',false,'code',raw_code);
end; $$;
revoke all on function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid,timestamptz) to authenticated;

create or replace function public.preview_organization_discount(p_organization_id uuid,p_code text,p_plan_key text,p_period_months integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare measured timestamptz; limiter public.billing_discount_checks%rowtype; discount public.billing_discount_codes%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':discount-check',0));
 measured:=clock_timestamp();
 select * into limiter from public.billing_discount_checks where actor_id=auth.uid();
 if not found or measured>=limiter.window_start+interval '15 minutes' then
 insert into public.billing_discount_checks(actor_id,window_start,attempts) values(auth.uid(),measured,0)
 on conflict(actor_id) do update set window_start=excluded.window_start,attempts=0 returning * into limiter; end if;
 if limiter.attempts>=10 then return jsonb_build_object('ok',false,'reason','rate_limited'); end if;
 update public.billing_discount_checks set attempts=attempts+1 where actor_id=auth.uid();
 if p_code is null or length(p_code)>128 then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
 select * into discount from public.billing_discount_codes where organization_id=p_organization_id
 and code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
 and plan_key=p_plan_key and period_months=p_period_months and activate_from<=measured and activate_before>measured;
 if not found then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
 return jsonb_build_object('ok',true,'organization_id',p_organization_id,'discount_id',discount.id,
 'plan_key',discount.plan_key,'discount_bps',discount.discount_bps,'eligible_periods',discount.eligible_periods,
 'period_months',discount.period_months,'activate_before',discount.activate_before);
end; $$;
revoke all on function public.preview_organization_discount(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_organization_discount(uuid,text,text,integer) to authenticated;

create or replace function platform_private.reserve_discount_period(p_order_id uuid,p_organization_id uuid,p_discount_id uuid,
 p_plan_key text,p_period_months integer,p_base_minor bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code public.billing_discount_codes%rowtype; previous public.billing_discount_reservations%rowtype;
 payload jsonb; amount jsonb; used integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_order_id is null or p_organization_id is null or p_discount_id is null then raise exception 'invalid discount reservation' using errcode='22023'; end if;
 -- Порядок блокировок одинаков для резервирования и завершения.
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,8201));
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,8202));
 payload:=jsonb_build_object('organization_id',p_organization_id,'discount_id',p_discount_id,'plan_key',p_plan_key,'period_months',p_period_months,'base_minor',p_base_minor);
 select * into previous from public.billing_discount_reservations where order_id=p_order_id;
 if found then
 if previous.request<>payload then raise exception 'discount order conflict' using errcode='22023'; end if;
 if previous.state='released' then raise exception 'discount reservation released' using errcode='55000'; end if;
 return previous.quote; end if;
 select * into code from public.billing_discount_codes where id=p_discount_id for update;
 if not found or code.organization_id<>p_organization_id or code.plan_key is distinct from p_plan_key
 or code.period_months is distinct from p_period_months then raise exception 'discount unavailable' using errcode='22023'; end if;
 -- Дедлайн действует для первой успешной покупки; продления использованной скидки
 -- не требуют повторной активации. Только reserved ещё не закрепляет скидку.
 if (code.activate_from>clock_timestamp() or code.activate_before<=clock_timestamp()) and not exists(select 1 from public.billing_discount_reservations
 where discount_id=code.id and state='consumed') then raise exception 'discount activation deadline expired' using errcode='22023'; end if;
 if exists(select 1 from public.billing_discount_reservations r join public.billing_discount_codes c on c.id=r.discount_id
 where r.organization_id=p_organization_id and r.discount_id<>code.id and
 (r.state='reserved' or (r.state='consumed' and
 (select count(*) from public.billing_discount_reservations x where x.discount_id=c.id and x.state='consumed')<c.eligible_periods))) then
 raise exception 'another discount active' using errcode='55000'; end if;
 select count(*) into used from public.billing_discount_reservations where discount_id=code.id and state in ('reserved','consumed');
 if used>=code.eligible_periods then raise exception 'discount periods exhausted' using errcode='55000'; end if;
 amount:=platform_private.calculate_discount_amount(p_base_minor,code.discount_bps)
 ||jsonb_build_object('discount_id',code.id,'period_months',code.period_months);
 insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote)
 values(p_order_id,code.id,p_organization_id,payload,amount);
 return amount;
end; $$;
revoke all on function platform_private.reserve_discount_period(uuid,uuid,uuid,text,integer,bigint) from public,anon,authenticated,service_role;


commit;