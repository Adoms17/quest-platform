begin;
create function public.get_organization_free_access_controls(p_organization_id uuid,p_device_key_hash text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; effective public.organization_subscriptions%rowtype;
 g public.billing_trial_access%rowtype; targets jsonb; available boolean; access_state text;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if p_device_key_hash is not null and p_device_key_hash !~ '^[0-9a-f]{64}$' then
   raise exception 'invalid browser key' using errcode='22023'; end if;
 select * into s from public.organization_subscriptions where organization_id=p_organization_id;
 effective:=public.effective_trial_subscription(s,statement_timestamp());
 select * into g from public.billing_trial_access where organization_id=p_organization_id and state<>'finished' order by ends_at desc limit 1;
 access_state:=g.state;
 if g.id is not null then
   if s.trial_access_id is distinct from g.id then access_state:='review';
   elsif statement_timestamp()>=g.ends_at then access_state:='finished';
   elsif statement_timestamp()>=g.starts_at then access_state:='active'; end if;
 end if;
 available:=coalesce(effective.status in ('free','unconfigured') or
   (effective.status='active' and effective.period_start<=statement_timestamp() and effective.period_end>statement_timestamp()),false)
   and not s.cancel_at_period_end and s.scheduled_plan_version_id is null
   and (g.id is null or access_state='finished');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'days',p.trial_duration_days,
   'active_quests',p.active_quests_limit,'team_members',p.team_members_limit,
   'eligible',available and p_device_key_hash is not null and not exists(select 1 from public.billing_trial_usage u where u.plan_key=p.plan_key
     and (u.actor_id=auth.uid() or u.organization_id=p_organization_id or u.device_key_hash=p_device_key_hash))) order by p.active_quests_limit),'[]'::jsonb)
 into targets from (select distinct on(plan_key) * from public.billing_plan_versions where plan_key<>'free' order by plan_key,version desc)p;
 return jsonb_build_object('organization_id',p_organization_id,'revision',s.revision,'available',available,
   'paid_until',case when effective.status='active' then effective.period_end else null end,'targets',targets,
   'current_access',case when g.id is null then null else jsonb_build_object('id',g.id,'kind',g.access_kind,'state',access_state,
     'name',(select display_name from public.billing_plan_versions where id=g.plan_version_id),'starts_at',g.starts_at,'ends_at',g.ends_at,
     'can_reconfirm',access_state='review' and not g.was_started and not exists(select 1 from public.billing_trial_transitions where access_id=g.id and kind='active'),
     'days',g.duration_days) end);
end;$$;
revoke all on function public.get_organization_free_access_controls(uuid,text) from public,anon,authenticated;
grant execute on function public.get_organization_free_access_controls(uuid,text) to authenticated;

create function public.preview_organization_promotion(p_organization_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; p public.billing_promotions%rowtype;
 r public.billing_promotion_rate_limits%rowtype; measured timestamptz; target public.billing_plan_versions%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'promotion requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':promotion-redeem',0));
 measured:=clock_timestamp();
 select * into r from public.billing_promotion_rate_limits where actor_id=auth.uid();
 if not found or measured>=r.window_start+interval '15 minutes' then
   insert into public.billing_promotion_rate_limits(actor_id,window_start,attempts) values(auth.uid(),measured,0)
   on conflict(actor_id) do update set window_start=excluded.window_start,attempts=0 returning * into r;
 end if;
 if r.attempts>=10 then return jsonb_build_object('ok',false,'reason','rate_limited'); end if;
 update public.billing_promotion_rate_limits set attempts=attempts+1 where actor_id=auth.uid();
 select * into p from public.billing_promotions where organization_id=p_organization_id
   and code_hash=encode(extensions.digest(upper(btrim(coalesce(p_code,''))),'sha256'),'hex');
 if not found or p.revoked_at is not null or p.redeemed_access_id is not null or measured>=p.activate_before then
   return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
 select * into s from public.organization_subscriptions where organization_id=p_organization_id;
 select * into target from public.billing_plan_versions where id=p.plan_version_id;
 return jsonb_build_object('ok',true,'organization_id',p_organization_id,'revision',s.revision,'id',p.id,
   'name',target.display_name,'days',p.duration_days,'active_quests',target.active_quests_limit,'team_members',target.team_members_limit,
   'activate_before',p.activate_before,'paid_until',case when s.status='active' and s.period_end>measured then s.period_end else null end);
end;$$;
revoke all on function public.preview_organization_promotion(uuid,text) from public,anon,authenticated;
grant execute on function public.preview_organization_promotion(uuid,text) to authenticated;

create function public.get_free_access_command_result(p_organization_id uuid,p_kind text,p_command_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if p_kind='trial' then
   select g.receipt into result from public.billing_trial_usage u join public.billing_trial_access g on g.id=u.id
   where u.actor_id=auth.uid() and u.organization_id=p_organization_id and u.command_id=p_command_id;
 elsif p_kind='promotion' then
   select c.receipt into result from public.billing_promotion_commands c where c.actor_id=auth.uid() and c.command_id=p_command_id and c.request->>'organization_id'=p_organization_id::text;
 elsif p_kind='reconfirm' then
   select c.receipt into result from public.billing_trial_reconfirmations c where c.actor_id=auth.uid() and c.command_id=p_command_id and c.request->>'organization_id'=p_organization_id::text;
 else raise exception 'invalid command kind' using errcode='22023'; end if;
 return jsonb_build_object('organization_id',p_organization_id,'found',result is not null,'receipt',result);
end;$$;
revoke all on function public.get_free_access_command_result(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_free_access_command_result(uuid,text,uuid) to authenticated;

-- После прошедшего trial новый запрос может зафиксировать уже наступивший Free.
do $$declare d text; needle text:='-- Конфликтный trial требует согласования сроков'; begin
 d:=pg_get_functiondef('public.request_organization_trial(uuid,uuid,text,uuid,bigint)'::regprocedure);
 if position(needle in d)=0 then raise exception 'trial reconciliation marker missing'; end if;
 execute replace(d,needle,'perform public.advance_organization_trial(p_organization_id); select * into s from public.organization_subscriptions where organization_id=p_organization_id; '||needle);
end;$$;
grant execute on function public.request_organization_trial(uuid,uuid,text,uuid,bigint),
 public.redeem_organization_promotion(uuid,text,uuid,bigint),public.reconfirm_organization_trial(uuid,uuid,uuid,bigint) to authenticated;
-- Выпуск, отзыв и прямой доступ к таблицам остаются закрытыми.
commit;
