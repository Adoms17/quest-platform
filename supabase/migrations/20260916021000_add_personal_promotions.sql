-- 6C-02.3: персональные промокоды. Только закрытый серверный API до UI/rollout.
begin;
create table public.billing_promotions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 plan_version_id uuid not null references public.billing_plan_versions(id),
 duration_days integer not null check(duration_days>0),
 activate_before timestamptz not null check(isfinite(activate_before)),
 code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
 issuer_id uuid not null,
 issue_command_id uuid not null,
 issued_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 redeemed_access_id uuid,
 unique(issuer_id,issue_command_id)
);
create table public.billing_promotion_commands (
 actor_id uuid not null, command_id uuid not null, request jsonb not null, receipt jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(), primary key(actor_id,command_id)
);
create table public.billing_promotion_rate_limits (
 actor_id uuid primary key, window_start timestamptz not null, attempts integer not null check(attempts>=0)
);
alter table public.billing_promotions enable row level security;
alter table public.billing_promotion_commands enable row level security;
alter table public.billing_promotion_rate_limits enable row level security;
revoke all on public.billing_promotions,public.billing_promotion_commands,public.billing_promotion_rate_limits from public,anon,authenticated,service_role;

-- Один движок бесплатных периодов, разные источники. Промокод не расходует trial.
alter table public.billing_trial_access drop constraint billing_trial_access_id_fkey,
 add column access_kind text not null default 'trial' check(access_kind in ('trial','promotion')),
 add column promotion_id uuid unique references public.billing_promotions(id),
 add column duration_days integer,
 add constraint billing_access_source_shape check((access_kind='trial' and promotion_id is null) or (access_kind='promotion' and promotion_id is not null));
update public.billing_trial_access g set duration_days=u.trial_duration_days from public.billing_trial_usage u where u.id=g.id;
alter table public.billing_trial_access alter column duration_days set not null,
 add check(duration_days>0);
alter table public.billing_promotions add foreign key(redeemed_access_id) references public.billing_trial_access(id);

create function public.initialize_billing_free_access() returns trigger language plpgsql security definer set search_path='' as $$
declare u public.billing_trial_usage%rowtype; p public.billing_promotions%rowtype;
begin
 if new.access_kind='trial' then
   select * into u from public.billing_trial_usage where id=new.id;
   if not found or u.organization_id<>new.organization_id or u.plan_version_id<>new.plan_version_id then
     raise exception 'invalid trial access source' using errcode='23514'; end if;
   new.duration_days:=u.trial_duration_days;
 else
   select * into p from public.billing_promotions where id=new.promotion_id;
   if not found or p.organization_id<>new.organization_id or p.plan_version_id<>new.plan_version_id then
     raise exception 'invalid promotion access source' using errcode='23514'; end if;
   new.duration_days:=p.duration_days;
 end if;
 return new;
end;$$;
revoke all on function public.initialize_billing_free_access() from public,anon,authenticated,service_role;
create trigger initialize_billing_free_access before insert on public.billing_trial_access for each row execute function public.initialize_billing_free_access();

-- Согласование нового расписания использует срок исходного бесплатного доступа.
do $$declare d text; needle text:='select trial_duration_days into duration from public.billing_trial_usage where id=g.id;'; begin
 d:=pg_get_functiondef('public.reconfirm_organization_trial(uuid,uuid,uuid,bigint)'::regprocedure);
 if position(needle in d)=0 then raise exception 'free access duration marker missing'; end if;
 execute replace(d,needle,'duration:=g.duration_days;');
end;$$;

create function public.issue_organization_promotion(p_organization_id uuid,p_plan_version_id uuid,p_duration_days integer,
 p_activate_before timestamptz,p_issuer_id uuid,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.billing_promotions%rowtype; raw_code text; measured timestamptz;
begin
 if p_issuer_id is null or p_command_id is null or p_organization_id is null or p_plan_version_id is null
   or p_duration_days is null or p_duration_days<1 or p_activate_before is null or not isfinite(p_activate_before) then
   raise exception 'invalid promotion issue' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_issuer_id::text||':promotion-issue:'||p_command_id::text,0));
 select * into p from public.billing_promotions where issuer_id=p_issuer_id and issue_command_id=p_command_id;
 if found then
   if (p.organization_id,p.plan_version_id,p.duration_days,p.activate_before) is distinct from
     (p_organization_id,p_plan_version_id,p_duration_days,p_activate_before) then
     raise exception 'promotion issue conflict' using errcode='22023'; end if;
   return jsonb_build_object('promotion_id',p.id,'code',null,'already_issued',true);
 end if;
 measured:=clock_timestamp();
 if p_activate_before<=measured or not exists(select 1 from public.billing_plan_versions where id=p_plan_version_id and plan_key<>'free') then
   raise exception 'invalid promotion issue' using errcode='22023'; end if;
 raw_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
 insert into public.billing_promotions(organization_id,plan_version_id,duration_days,activate_before,code_hash,issuer_id,issue_command_id)
 values(p_organization_id,p_plan_version_id,p_duration_days,p_activate_before,
   encode(extensions.digest(raw_code,'sha256'),'hex'),p_issuer_id,p_command_id) returning * into p;
 return jsonb_build_object('promotion_id',p.id,'code',raw_code,'already_issued',false);
end;$$;
revoke all on function public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid) to service_role;
comment on function public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid) is
 'Только доверенный backend платформы. issuer_id задаёт проверенный сервер, не владелец организации. Код возвращается один раз; в базе только hash. При потере ответа отозвать неиспользованный код и выпустить новый. UI/роли платформы отдельной фазой.';

create function public.revoke_organization_promotion(p_promotion_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.billing_promotions%rowtype;
begin
 select * into p from public.billing_promotions where id=p_promotion_id for update;
 if not found then raise exception 'promotion missing' using errcode='P0001'; end if;
 if p.redeemed_access_id is not null then raise exception 'promotion already redeemed' using errcode='P0001'; end if;
 update public.billing_promotions set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p.id;
 return jsonb_build_object('revoked',true,'promotion_id',p.id);
end;$$;
revoke all on function public.revoke_organization_promotion(uuid) from public,anon,authenticated;
grant execute on function public.revoke_organization_promotion(uuid) to service_role;

create function public.redeem_organization_promotion(p_organization_id uuid,p_code text,p_command_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.organization_subscriptions%rowtype; p public.billing_promotions%rowtype;
 c public.billing_promotion_commands%rowtype; r public.billing_promotion_rate_limits%rowtype;
 request jsonb; result jsonb; measured timestamptz; fingerprint text; v_id uuid; v_free uuid;
 v_start timestamptz; v_end timestamptz; v_state text; previous jsonb;
begin
 if actor is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if p_command_id is null or p_expected_revision is null or p_expected_revision<0 then
   raise exception 'invalid promotion command' using errcode='22023'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'promotion requires read committed' using errcode='40001'; end if;
 -- Общая блокировка аккаунта сериализует rate limit между его организациями.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':promotion-redeem',0));
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not found or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 fingerprint:=encode(extensions.digest(upper(btrim(coalesce(p_code,''))),'sha256'),'hex');
 request:=jsonb_build_object('organization_id',p_organization_id,'code_hash',fingerprint,'expected_revision',p_expected_revision);
 select * into c from public.billing_promotion_commands where actor_id=actor and command_id=p_command_id;
 if found then
   if c.request<>request then raise exception 'promotion command conflict' using errcode='22023'; end if;
   return c.receipt;
 end if;
 measured:=clock_timestamp();
 select * into r from public.billing_promotion_rate_limits where actor_id=actor;
 if not found or measured>=r.window_start+interval '15 minutes' then
   insert into public.billing_promotion_rate_limits(actor_id,window_start,attempts) values(actor,measured,0)
   on conflict(actor_id) do update set window_start=excluded.window_start,attempts=0 returning * into r;
 end if;
 if r.attempts>=10 then
   -- Не создаём неограниченный журнал отказов после достижения лимита.
   return jsonb_build_object('ok',false,'reason','rate_limited','retry_at',r.window_start+interval '15 minutes');
 end if;
 update public.billing_promotion_rate_limits set attempts=attempts+1 where actor_id=actor;
 if s.revision<>p_expected_revision then result:=jsonb_build_object('ok',false,'reason','revision_conflict');
 else
   select * into p from public.billing_promotions where organization_id=p_organization_id and code_hash=fingerprint for update;
   measured:=clock_timestamp();
   if not found or p.revoked_at is not null or p.redeemed_access_id is not null or measured>=p.activate_before then
     result:=jsonb_build_object('ok',false,'reason','invalid_code');
   else
     perform public.advance_organization_trial(p_organization_id);
     select * into s from public.organization_subscriptions where organization_id=p_organization_id;
     if exists(select 1 from public.billing_trial_access where organization_id=p_organization_id and state<>'finished')
       or s.cancel_at_period_end or s.scheduled_plan_version_id is not null then
       result:=jsonb_build_object('ok',false,'reason','access_conflict');
     elsif not (s.status in ('free','unconfigured') or (s.status='active' and s.period_start<=measured and s.period_end>measured)) then
       result:=jsonb_build_object('ok',false,'reason','period_unavailable');
     else
       previous:=to_jsonb(s);
       if s.status='active' then v_start:=s.period_end; v_state:='scheduled'; else v_start:=measured; v_state:='active'; end if;
       v_end:=v_start+make_interval(hours=>24)*p.duration_days;
       select id into v_free from public.billing_plan_versions where plan_key='free' and version=1;
       if v_free is null then raise exception 'free plan unavailable' using errcode='P0001'; end if;
       v_id:=gen_random_uuid();
       result:=jsonb_build_object('ok',true,'access_id',v_id,'promotion_id',p.id,'organization_id',p_organization_id,
         'plan_version_id',p.plan_version_id,'access_kind','promotion','state',v_state,'starts_at',v_start,'ends_at',v_end,'after_plan_version_id',v_free);
       insert into public.billing_trial_access(id,organization_id,plan_version_id,free_plan_version_id,starts_at,ends_at,
         source_state,request,receipt,state,access_kind,promotion_id)
       values(v_id,p_organization_id,p.plan_version_id,v_free,v_start,v_end,previous,request,result,v_state,'promotion',p.id);
       if v_state='active' then
         update public.organization_subscriptions set status='trial',plan_version_id=p.plan_version_id,period_start=v_start,
           period_end=v_end,trial_access_id=v_id where organization_id=p_organization_id returning * into s;
       else
         update public.organization_subscriptions set trial_access_id=v_id where organization_id=p_organization_id returning * into s;
       end if;
       update public.billing_promotions set redeemed_access_id=v_id where id=p.id;
       insert into public.billing_trial_transitions(access_id,kind,before_state,after_state) values(v_id,v_state,previous,to_jsonb(s));
     end if;
   end if;
 end if;
 -- Отказы возвращаются, а не бросаются: счётчик попыток должен сохраниться.
 insert into public.billing_promotion_commands(actor_id,command_id,request,receipt) values(actor,p_command_id,request,result);
 return result;
end;$$;
revoke all on function public.redeem_organization_promotion(uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.redeem_organization_promotion(uuid,text,uuid,bigint) to service_role;
comment on function public.redeem_organization_promotion(uuid,text,uuid,bigint) is
 'Закрыто до UI. Одна активация для указанной организации, 10 новых проверок на аккаунт за 15 минут; retry receipt без повторного расхода. Ошибки ok=false сохраняются commit, не превращать в SQL exception. Не логировать p_code.';
commit;
