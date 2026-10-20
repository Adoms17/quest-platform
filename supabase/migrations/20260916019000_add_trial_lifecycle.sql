-- Серверный lifecycle trial. Пользовательский RPC закрыт до интеграции браузера/UI.
begin;
create table public.billing_trial_access (
 id uuid primary key references public.billing_trial_usage(id),
 organization_id uuid not null,
 plan_version_id uuid not null references public.billing_plan_versions(id),
 free_plan_version_id uuid not null references public.billing_plan_versions(id),
 starts_at timestamptz not null check(isfinite(starts_at)),
 ends_at timestamptz not null check(isfinite(ends_at)),
 source_state jsonb not null,
 request jsonb not null,
 receipt jsonb not null,
 state text not null check(state in ('scheduled','active','finished','review')),
 check(ends_at>starts_at)
);
create unique index billing_trial_access_one_pending on public.billing_trial_access(organization_id)
 where state in ('scheduled','active');
create table public.billing_trial_transitions (
 id bigint generated always as identity primary key,
 access_id uuid not null references public.billing_trial_access(id),
 kind text not null check(kind in ('scheduled','active','finished','review')),
 recorded_at timestamptz not null default clock_timestamp(),
 before_state jsonb not null,
 after_state jsonb not null,
 unique(access_id,kind)
);
alter table public.billing_trial_access enable row level security;
alter table public.billing_trial_transitions enable row level security;
revoke all on public.billing_trial_access,public.billing_trial_transitions from public,anon,authenticated,service_role;
alter table public.organization_subscriptions add column trial_access_id uuid references public.billing_trial_access(id);

-- Сопоставляем исходный оплаченный период либо уже применённый trial.
create function public.trial_access_matches(s public.organization_subscriptions,g public.billing_trial_access)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(s.organization_id=g.organization_id and (
   (s.status in ('active','expired') and g.source_state->>'status'='active'
     and s.plan_version_id=(g.source_state->>'plan_version_id')::uuid
     and s.period_start=(g.source_state->>'period_start')::timestamptz
     and s.period_end=(g.source_state->>'period_end')::timestamptz)
   or (s.status in ('trial','expired') and s.plan_version_id=g.plan_version_id
     and s.period_start=g.starts_at and s.period_end=g.ends_at)
 ),false);
$$;
revoke all on function public.trial_access_matches(public.organization_subscriptions,public.billing_trial_access) from public,anon,authenticated,service_role;

create function public.invalidate_trial_access_binding() returns trigger
language plpgsql security definer set search_path='' as $$
declare g public.billing_trial_access%rowtype;
begin
 if old.trial_access_id is not null and new.trial_access_id is not null
   and (new.cancel_at_period_end is distinct from old.cancel_at_period_end
     or new.scheduled_plan_version_id is distinct from old.scheduled_plan_version_id)
   and (new.cancel_at_period_end or new.scheduled_plan_version_id is not null) then
   raise exception 'trial billing intent conflict' using errcode='P0001';
 end if;
 if new.trial_access_id is not null then
   select * into g from public.billing_trial_access where id=new.trial_access_id;
   if not public.trial_access_matches(new,g) then new.trial_access_id:=null; end if;
 end if;
 return new;
end;
$$;
revoke all on function public.invalidate_trial_access_binding() from public,anon,authenticated,service_role;
create trigger a_invalidate_trial_access before update on public.organization_subscriptions
 for each row execute function public.invalidate_trial_access_binding();

-- Чтение и квоты видят границу периода точно, даже если runner ещё не запускался.
create function public.effective_trial_subscription(s public.organization_subscriptions,p_at timestamptz)
returns public.organization_subscriptions language plpgsql stable security definer set search_path='' as $$
declare g public.billing_trial_access%rowtype;
begin
 if s.trial_access_id is null then return s; end if;
 select * into g from public.billing_trial_access where id=s.trial_access_id;
 if g.state not in ('scheduled','active') or not public.trial_access_matches(s,g) or p_at<g.starts_at then return s; end if;
 if p_at>=g.ends_at then
   s.status:='free'; s.plan_version_id:=g.free_plan_version_id; s.period_start:=null; s.period_end:=null;
 else
   s.status:='trial'; s.plan_version_id:=g.plan_version_id; s.period_start:=g.starts_at; s.period_end:=g.ends_at;
 end if;
 s.cancel_at_period_end:=false; s.scheduled_plan_version_id:=null; s.scheduled_effective_at:=null;
 return s;
end;
$$;
revoke all on function public.effective_trial_subscription(public.organization_subscriptions,timestamptz) from public,anon,authenticated,service_role;

alter function public.resolve_subscription_quota_phase(public.organization_subscriptions,timestamptz) rename to resolve_subscription_quota_phase_before_trial;
revoke all on function public.resolve_subscription_quota_phase_before_trial(public.organization_subscriptions,timestamptz) from public,anon,authenticated,service_role;
create function public.resolve_subscription_quota_phase(s public.organization_subscriptions,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 s:=public.effective_trial_subscription(s,p_at);
 return public.resolve_subscription_quota_phase_before_trial(s,p_at)
   ||jsonb_build_object('effective_plan_version_id',s.plan_version_id);
end;
$$;
revoke all on function public.resolve_subscription_quota_phase(public.organization_subscriptions,timestamptz) from public,anon,authenticated,service_role;

do $$
declare signature text; definition text; needle text;
begin
 foreach signature in array array['public.enforce_active_quest_quota()','public.enforce_team_member_quota()'] loop
   definition:=pg_get_functiondef(signature::regprocedure);
   needle:='where p.id=subscription.plan_version_id and lifecycle';
   if position(needle in definition)=0 then raise exception 'quota integration marker missing'; end if;
   execute replace(definition,needle,'where p.id=(lifecycle->>''effective_plan_version_id'')::uuid and lifecycle');
 end loop;
 definition:=pg_get_functiondef('public.get_organization_billing_state(uuid)'::regprocedure);
 needle:='select p.plan_key, jsonb_build_object(';
 if position(needle in definition)=0 then raise exception 'billing state integration marker missing'; end if;
 definition:=replace(definition,'''stored_status'',subscription.status',
   '''stored_status'',(select status from public.organization_subscriptions where organization_id=p_organization_id)');
 execute replace(definition,needle,'subscription:=public.effective_trial_subscription(subscription,statement_timestamp()); '||needle);
end;
$$;

create function public.advance_organization_trial(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; e public.organization_subscriptions%rowtype;
 g public.billing_trial_access%rowtype; outcome text; before_state jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'trial requires read committed' using errcode='40001'; end if;
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not found then return jsonb_build_object('changed',false); end if;
 select * into g from public.billing_trial_access where organization_id=p_organization_id and state in ('scheduled','active');
 if not found then return jsonb_build_object('changed',false); end if;
 before_state:=to_jsonb(s);
 if s.trial_access_id is distinct from g.id or not public.trial_access_matches(s,g) then
   outcome:='review';
 else
   e:=public.effective_trial_subscription(s,clock_timestamp());
   if e.status='free' then outcome:='finished';
   elsif e.status='trial' and g.state='scheduled' then outcome:='active';
   else return jsonb_build_object('changed',false); end if;
   update public.organization_subscriptions set status=e.status,plan_version_id=e.plan_version_id,
     period_start=e.period_start,period_end=e.period_end,cancel_at_period_end=false,
     scheduled_plan_version_id=null,scheduled_effective_at=null,
     trial_access_id=case when outcome='finished' then null else g.id end
     where organization_id=p_organization_id returning * into s;
 end if;
 update public.billing_trial_access set state=outcome where id=g.id;
 insert into public.billing_trial_transitions(access_id,kind,before_state,after_state)
   values(g.id,outcome,before_state,to_jsonb(s)) on conflict(access_id,kind) do nothing;
 return jsonb_build_object('changed',true,'outcome',outcome,'access_id',g.id);
end;
$$;
revoke all on function public.advance_organization_trial(uuid) from public,anon,authenticated;
grant execute on function public.advance_organization_trial(uuid) to service_role;

create function public.request_organization_trial(p_organization_id uuid,p_plan_version_id uuid,
 p_device_key_hash text,p_command_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.organization_subscriptions%rowtype; p public.billing_plan_versions%rowtype;
 u public.billing_trial_usage%rowtype; g public.billing_trial_access%rowtype;
 request jsonb; v_receipt jsonb; v_start timestamptz; v_end timestamptz; measured timestamptz;
 v_free uuid; v_state text; before_state jsonb;
begin
 if actor is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if p_plan_version_id is null or p_command_id is null or p_expected_revision is null or p_expected_revision<0
   or p_device_key_hash is null or p_device_key_hash !~ '^[0-9a-f]{64}$' then
   raise exception 'invalid trial command' using errcode='22023'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'trial requires read committed' using errcode='40001'; end if;
 -- Команда сериализуется и между организациями одного аккаунта.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':trial:'||p_command_id::text,0));
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 request:=jsonb_build_object('organization_id',p_organization_id,'plan_version_id',p_plan_version_id,
   'device_key_hash',p_device_key_hash,'expected_revision',p_expected_revision);
 select * into u from public.billing_trial_usage where actor_id=actor and command_id=p_command_id;
 if found then
   select * into g from public.billing_trial_access where id=u.id;
   if g.id is null or g.request<>request then raise exception 'trial command conflict' using errcode='22023'; end if;
   return g.receipt;
 end if;
 if s.revision<>p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
 -- Конфликтный trial требует согласования сроков, не выдаётся заново другим кодом команды.
 if exists(select 1 from public.billing_trial_access where organization_id=p_organization_id and state<>'finished') then
   raise exception 'trial already pending' using errcode='P0001'; end if;
 if s.scheduled_plan_version_id is not null or s.cancel_at_period_end then
   raise exception 'billing intent conflict' using errcode='P0001'; end if;
 select * into p from public.billing_plan_versions where id=p_plan_version_id;
 if not found or p.plan_key='free' then raise exception 'trial requires a paid plan' using errcode='22023'; end if;
 select id into v_free from public.billing_plan_versions where plan_key='free' and version=1;
 if v_free is null then raise exception 'free plan unavailable' using errcode='P0001'; end if;
 measured:=clock_timestamp();
 if s.status='active' and s.period_start<=measured and s.period_end>measured then
   v_start:=s.period_end; v_state:='scheduled';
 elsif s.status in ('free','unconfigured') then
   v_start:=measured; v_state:='active';
 else
   raise exception 'trial requires free or current paid period' using errcode='P0001';
 end if;
 v_end:=v_start+make_interval(hours=>24)*p.trial_duration_days;
 before_state:=to_jsonb(s);
 -- Уникальные индексы атомарно защищают аккаунт, организацию и браузер для plan_key.
 begin
   insert into public.billing_trial_usage(organization_id,actor_id,command_id,plan_version_id,device_key_hash)
     values(p_organization_id,actor,p_command_id,p.id,p_device_key_hash) returning * into u;
 exception when unique_violation then raise exception 'trial already used' using errcode='P0001'; end;
 v_receipt:=jsonb_build_object('access_id',u.id,'organization_id',s.organization_id,'plan_version_id',p.id,
   'state',v_state,'starts_at',v_start,'ends_at',v_end,'after_plan_version_id',v_free);
 insert into public.billing_trial_access(id,organization_id,plan_version_id,free_plan_version_id,starts_at,ends_at,source_state,request,receipt,state)
   values(u.id,s.organization_id,p.id,v_free,v_start,v_end,before_state,request,v_receipt,v_state);
 if v_state='active' then
   update public.organization_subscriptions set status='trial',plan_version_id=p.id,period_start=v_start,period_end=v_end,
     trial_access_id=u.id where organization_id=s.organization_id returning * into s;
 else
   update public.organization_subscriptions set trial_access_id=u.id where organization_id=s.organization_id returning * into s;
 end if;
 insert into public.billing_trial_transitions(access_id,kind,before_state,after_state)
   values(u.id,v_state,before_state,to_jsonb(s));
 return v_receipt;
end;
$$;
revoke all on function public.request_organization_trial(uuid,uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.request_organization_trial(uuid,uuid,text,uuid,bigint) to service_role;
comment on function public.request_organization_trial(uuid,uuid,text,uuid,bigint) is
 'Закрытая до браузерной интеграции команда с auth.uid и billing.manage. Подтверждение резервирует однократное право сразу; receipt исторический. При конфликте оплаты trial требует проверки, право не выдаётся повторно.';

alter function public.run_billing_lifecycle(integer) rename to run_billing_lifecycle_before_trial;
revoke all on function public.run_billing_lifecycle_before_trial(integer) from public,anon,authenticated,service_role;
create function public.run_billing_lifecycle(p_batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; candidate record; changed integer:=0; outcome jsonb;
begin
 v_result:=public.run_billing_lifecycle_before_trial(p_batch_size);
 if (v_result->>'busy')::boolean then return v_result; end if;
 for candidate in select s.organization_id from public.organization_subscriptions s
   join public.billing_trial_access g on g.organization_id=s.organization_id and g.state in ('scheduled','active')
   where s.trial_access_id is distinct from g.id
     or (g.state='scheduled' and g.starts_at<=clock_timestamp())
     or (g.state='active' and g.ends_at<=clock_timestamp())
   order by g.ends_at,s.organization_id limit p_batch_size for update of s skip locked
 loop
   outcome:=public.advance_organization_trial(candidate.organization_id);
   if (outcome->>'changed')::boolean then changed:=changed+1; end if;
 end loop;
 v_result:=v_result||jsonb_build_object('trial_transitions',changed);
 update public.billing_lifecycle_runs set result=v_result,finished_at=clock_timestamp() where id=(v_result->>'run_id')::bigint;
 return v_result;
end;
$$;
revoke all on function public.run_billing_lifecycle(integer) from public,anon,authenticated;
grant execute on function public.run_billing_lifecycle(integer) to service_role;
commit;
