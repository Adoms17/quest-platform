begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read','billing.campaign.draft'));
insert into public.platform_role_permissions values ('owner','billing.campaign.draft'),('sales','billing.campaign.draft');
-- Персональная акция: редакция черновика становится неизменяемой после утверждения.
create table public.platform_discount_campaigns (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 title text not null check(length(btrim(title)) between 1 and 120),
 plan_key text not null check(plan_key<>'free'),
 discount_bps integer not null check(discount_bps between 1 and 10000),
 eligible_periods integer not null check(eligible_periods>0),
 period_months integer not null check(period_months>0),
 activate_before timestamptz not null check(isfinite(activate_before)),
 revision integer not null default 1 check(revision>0),
 state text not null default 'draft' check(state in ('draft','approved')),
 approved_by uuid references auth.users(id), approved_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((state='draft' and approved_by is null and approved_at is null) or (state='approved' and approved_by is not null and approved_at is not null))
);
create table public.platform_discount_campaign_commands (
 command_id uuid primary key,
 actor_id uuid not null references auth.users(id),
 request jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_discount_campaigns enable row level security;
alter table public.platform_discount_campaign_commands enable row level security;
revoke all on public.platform_discount_campaigns,public.platform_discount_campaign_commands from public,anon,authenticated,service_role;
create function platform_private.protect_discount_campaign() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.state='approved' then raise exception 'approved campaign immutable' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function platform_private.protect_discount_campaign() from public,anon,authenticated,service_role;
create trigger protect_discount_campaign before update or delete on public.platform_discount_campaigns for each row execute function platform_private.protect_discount_campaign();

create function public.save_platform_discount_campaign(p_command_id uuid,p_id uuid,p_organization_id uuid,p_expected_revision integer,
 p_title text,p_plan_key text,p_discount_bps integer,p_eligible_periods integer,p_period_months integer,p_activate_before timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; receipt public.platform_discount_campaign_commands%rowtype; draft public.platform_discount_campaigns%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock(18092026,1);
 -- Редактирование отделено от чтения, область берётся из того же назначения.
 perform public.require_platform_permission('billing.campaign.draft',p_organization_id);
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
 if draft.organization_id<>p_organization_id then raise exception 'platform access denied' using errcode='42501'; end if;
 if draft.state<>'draft' then raise exception 'approved campaign immutable' using errcode='55000'; end if;
 if draft.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 update public.platform_discount_campaigns set title=btrim(p_title),plan_key=p_plan_key,discount_bps=p_discount_bps,
 eligible_periods=p_eligible_periods,period_months=p_period_months,activate_before=p_activate_before,
 revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into draft;
 else
 if p_expected_revision<>0 then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 insert into public.platform_discount_campaigns(id,organization_id,title,plan_key,discount_bps,eligible_periods,period_months,activate_before)
 values(p_id,p_organization_id,btrim(p_title),p_plan_key,p_discount_bps,p_eligible_periods,p_period_months,p_activate_before) returning * into draft;
 end if;
 result:=to_jsonb(draft);
 insert into public.platform_discount_campaign_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,result);
 return result;
end; $$;
revoke all on function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_platform_discount_campaign(uuid,uuid,uuid,integer,text,text,integer,integer,integer,timestamptz) to authenticated;

create function public.approve_platform_discount_campaign(p_command_id uuid,p_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare draft public.platform_discount_campaigns%rowtype; receipt public.platform_discount_campaign_commands%rowtype; payload jsonb; result jsonb;
begin
 perform pg_advisory_xact_lock(18092026,1);
 perform public.require_platform_owner();
 if p_command_id is null or p_id is null or p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid campaign approval' using errcode='22023'; end if;
 payload:=jsonb_build_object('operation','approve','id',p_id,'revision',p_expected_revision);
 select * into receipt from public.platform_discount_campaign_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then raise exception 'campaign command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 select * into draft from public.platform_discount_campaigns where id=p_id for update;
 if not found then raise exception 'campaign unavailable' using errcode='22023'; end if;
 if draft.state<>'draft' then raise exception 'approved campaign immutable' using errcode='55000'; end if;
 if draft.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 if draft.activate_before<=clock_timestamp() then raise exception 'campaign deadline expired' using errcode='22023'; end if;
 update public.platform_discount_campaigns set state='approved',approved_by=auth.uid(),approved_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id returning * into draft;
 result:=to_jsonb(draft);
 insert into public.platform_discount_campaign_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,result);
 return result;
end; $$;
revoke all on function public.approve_platform_discount_campaign(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.approve_platform_discount_campaign(uuid,uuid,integer) to authenticated;
commit;