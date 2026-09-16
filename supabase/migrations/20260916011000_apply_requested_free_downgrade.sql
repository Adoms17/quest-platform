begin;
create table public.billing_free_downgrade_events (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 source_revision bigint not null,
 before_state jsonb not null,
 after_state jsonb not null,
 applied_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,source_revision)
);
alter table public.billing_free_downgrade_events enable row level security;
revoke all on public.billing_free_downgrade_events from public,anon,authenticated;

create function public.apply_requested_free_downgrade(p_organization_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; e public.billing_free_downgrade_events%rowtype;
 assessment jsonb; previous jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'billing lifecycle requires read committed' using errcode='40001'; end if;
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
 select * into e from public.billing_free_downgrade_events
   where organization_id=p_organization_id and source_revision=p_expected_revision;
 if found then return jsonb_build_object('applied',true,'revision',e.after_state->'revision'); end if;
 if p_expected_revision is null or s.revision<>p_expected_revision then
   raise exception 'billing revision conflict' using errcode='40001'; end if;
 assessment:=public.evaluate_organization_billing_intent(p_organization_id);
 if assessment->>'intent_kind' is distinct from 'downgrade' or assessment->>'outcome'<>'due'
   or not exists(select 1 from public.billing_plan_versions where id=s.scheduled_plan_version_id and plan_key='free') then
   return jsonb_build_object('applied',false,'outcome',assessment->>'outcome');
 end if;
 previous:=to_jsonb(s);
 update public.organization_subscriptions set status='free',plan_version_id=s.scheduled_plan_version_id,
   period_start=null,period_end=null,scheduled_plan_version_id=null,scheduled_effective_at=null
   where organization_id=p_organization_id returning * into s;
 insert into public.billing_free_downgrade_events(organization_id,source_revision,before_state,after_state)
   values(p_organization_id,p_expected_revision,previous,to_jsonb(s));
 return jsonb_build_object('applied',true,'revision',s.revision);
end;
$$;
revoke all on function public.apply_requested_free_downgrade(uuid,bigint) from public,anon,authenticated;
grant execute on function public.apply_requested_free_downgrade(uuid,bigint) to service_role;
comment on function public.apply_requested_free_downgrade(uuid,bigint) is
 'Только явно запланированный Free на границе исходного периода. Не автоматический fallback; платный downgrade требует отдельного доверенного подтверждения. Ресурсы не удаляются.';

-- Базовый runner остаётся закрытым, новая обёртка использует ту же блокировку.
alter function public.run_billing_lifecycle(integer) rename to run_billing_lifecycle_base;
revoke all on function public.run_billing_lifecycle_base(integer) from public,anon,authenticated,service_role;
create function public.run_billing_lifecycle(p_batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; outcome jsonb; applied integer:=0; v_result jsonb;
begin
 v_result:=public.run_billing_lifecycle_base(p_batch_size);
 if (v_result->>'busy')::boolean then return v_result; end if;
 for candidate in
   select s.organization_id,s.revision from public.organization_subscriptions s
   join public.billing_plan_versions p on p.id=s.scheduled_plan_version_id and p.plan_key='free'
   where s.scheduled_effective_at<=clock_timestamp() and not s.scheduled_intent_stale
     and s.status in ('active','expired')
   order by s.scheduled_effective_at,s.organization_id limit p_batch_size for update of s skip locked
 loop
   outcome:=public.apply_requested_free_downgrade(candidate.organization_id,candidate.revision);
   if (outcome->>'applied')::boolean then applied:=applied+1; end if;
 end loop;
 v_result:=v_result||jsonb_build_object('free_downgrades',applied);
 update public.billing_lifecycle_runs set result=v_result,finished_at=clock_timestamp() where id=(v_result->>'run_id')::bigint;
 return v_result;
end;
$$;
revoke all on function public.run_billing_lifecycle(integer) from public,anon,authenticated;
grant execute on function public.run_billing_lifecycle(integer) to service_role;
commit;
