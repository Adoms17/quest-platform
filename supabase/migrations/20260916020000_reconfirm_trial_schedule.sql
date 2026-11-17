-- Повторное согласование сроков ранее зарезервированного trial после новой оплаты.
begin;
alter table public.billing_trial_access add column generation integer not null default 0 check(generation>=0),
 add column was_started boolean not null default false;
update public.billing_trial_access g set was_started=true where exists(
 select 1 from public.billing_trial_transitions e where e.access_id=g.id and e.kind='active');
alter table public.billing_trial_transitions add column generation integer not null default 0,
 drop constraint billing_trial_transitions_access_id_kind_key,
 add unique(access_id,kind,generation);
create table public.billing_trial_reconfirmations (
 actor_id uuid not null,
 command_id uuid not null,
 access_id uuid not null references public.billing_trial_access(id),
 request jsonb not null,
 receipt jsonb not null,
 primary key(actor_id,command_id)
);
alter table public.billing_trial_reconfirmations enable row level security;
revoke all on public.billing_trial_reconfirmations from public,anon,authenticated,service_role;

do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.advance_organization_trial(uuid)'::regprocedure);
 if position('on conflict(access_id,kind) do nothing' in definition)=0 then raise exception 'trial audit marker missing'; end if;
 definition:=replace(definition,'(access_id,kind,before_state,after_state)','(access_id,kind,before_state,after_state,generation)');
 definition:=replace(definition,'values(g.id,outcome,before_state,to_jsonb(s)) on conflict(access_id,kind) do nothing',
   'values(g.id,outcome,before_state,to_jsonb(s),g.generation) on conflict(access_id,kind,generation) do nothing');
 definition:=replace(definition,'outcome:=''review'';',
   'if g.was_started or exists(select 1 from public.billing_trial_transitions where access_id=g.id and kind=''active'') then
      outcome:=''finished'';
    else outcome:=''review''; end if;');
 execute definition;
 definition:=pg_get_functiondef('public.invalidate_trial_access_binding()'::regprocedure);
 definition:=replace(definition,'then new.trial_access_id:=null; end if;',
   'then
     if old.trial_access_id=g.id and public.trial_access_matches(old,g) and clock_timestamp()>=g.starts_at then
       update public.billing_trial_access set was_started=true where id=g.id;
     end if;
     new.trial_access_id:=null;
   end if;');
 execute definition;
end;
$$;

create function public.reconfirm_organization_trial(p_organization_id uuid,p_access_id uuid,p_command_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.organization_subscriptions%rowtype; g public.billing_trial_access%rowtype;
 c public.billing_trial_reconfirmations%rowtype; request jsonb; v_receipt jsonb; before_state jsonb;
 measured timestamptz; v_start timestamptz; v_end timestamptz; duration integer; next_state text;
begin
 if actor is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if p_access_id is null or p_command_id is null or p_expected_revision is null or p_expected_revision<0 then
   raise exception 'invalid trial command' using errcode='22023'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'trial requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':trial:'||p_command_id::text,0));
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 request:=jsonb_build_object('organization_id',p_organization_id,'access_id',p_access_id,'expected_revision',p_expected_revision);
 select * into c from public.billing_trial_reconfirmations where actor_id=actor and command_id=p_command_id;
 if found then
   if c.request<>request then raise exception 'trial command conflict' using errcode='22023'; end if;
   return c.receipt;
 end if;
 if exists(select 1 from public.billing_trial_usage where actor_id=actor and command_id=p_command_id) then
   raise exception 'trial command conflict' using errcode='22023'; end if;
 if s.revision<>p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
 select * into g from public.billing_trial_access where id=p_access_id and organization_id=p_organization_id;
 if not found or g.state<>'review' then raise exception 'trial is not awaiting review' using errcode='P0001'; end if;
 -- Начатый trial нельзя перезапустить с полной длительностью через новую оплату.
 if g.was_started or exists(select 1 from public.billing_trial_transitions where access_id=g.id and kind='active') then
   raise exception 'started trial cannot be rescheduled' using errcode='P0001'; end if;
 if s.trial_access_id is not null or s.cancel_at_period_end or s.scheduled_plan_version_id is not null then
   raise exception 'billing intent conflict' using errcode='P0001'; end if;
 measured:=clock_timestamp();
 if s.status='active' and s.period_start<=measured and s.period_end>measured then
   v_start:=s.period_end; next_state:='scheduled';
 elsif s.status in ('free','unconfigured') then
   v_start:=measured; next_state:='active';
 else raise exception 'trial requires free or current paid period' using errcode='P0001'; end if;
 select trial_duration_days into duration from public.billing_trial_usage where id=g.id;
 v_end:=v_start+make_interval(hours=>24)*duration;
 before_state:=to_jsonb(s);
 update public.billing_trial_access set starts_at=v_start,ends_at=v_end,source_state=before_state,
   state=next_state,generation=g.generation+1 where id=g.id returning * into g;
 if next_state='active' then
   update public.organization_subscriptions set status='trial',plan_version_id=g.plan_version_id,
     period_start=v_start,period_end=v_end,trial_access_id=g.id where organization_id=p_organization_id returning * into s;
 else
   update public.organization_subscriptions set trial_access_id=g.id where organization_id=p_organization_id returning * into s;
 end if;
 v_receipt:=jsonb_build_object('access_id',g.id,'organization_id',s.organization_id,'plan_version_id',g.plan_version_id,
   'state',next_state,'starts_at',v_start,'ends_at',v_end,'generation',g.generation,'after_plan_version_id',g.free_plan_version_id);
 insert into public.billing_trial_reconfirmations(actor_id,command_id,access_id,request,receipt)
   values(actor,p_command_id,g.id,request,v_receipt);
 insert into public.billing_trial_transitions(access_id,kind,before_state,after_state,generation)
   values(g.id,next_state,before_state,to_jsonb(s),g.generation);
 return v_receipt;
end;
$$;
revoke all on function public.reconfirm_organization_trial(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.reconfirm_organization_trial(uuid,uuid,uuid,bigint) to service_role;

-- Общая область ключей команд: reconfirm нельзя затем использовать для другого trial.
do $$
declare definition text; needle text:='if s.revision<>p_expected_revision then';
begin
 definition:=pg_get_functiondef('public.request_organization_trial(uuid,uuid,text,uuid,bigint)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'trial command marker missing'; end if;
 execute replace(definition,needle,
   'if exists(select 1 from public.billing_trial_reconfirmations where actor_id=actor and command_id=p_command_id) then raise exception ''trial command conflict'' using errcode=''22023''; end if; '||needle);
end;
$$;
commit;
