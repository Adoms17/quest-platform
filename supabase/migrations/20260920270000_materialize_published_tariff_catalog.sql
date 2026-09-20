begin;
-- Снимок публикации и платёжный каталог используют один UUID.
-- Время доступности определяется timeline, не наличием строки каталога.
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at)
 select v.id,v.plan_key,v.version,v.display_name,v.active_quests_limit,v.team_members_limit,v.trial_duration_days,v.created_at
 from public.platform_fixed_tariff_versions v join public.billing_tariff_timeline t on t.fixed_version_id=v.id
 where not exists(select 1 from public.billing_plan_versions p where p.id=v.id);
do $$
declare definition text; marker text;
begin
 if exists(select 1 from public.platform_fixed_tariff_versions v join public.billing_tariff_timeline t on t.fixed_version_id=v.id
 join public.billing_plan_versions p on p.id=v.id
 where row(v.plan_key,v.version,v.display_name,v.active_quests_limit,v.team_members_limit,v.trial_duration_days)
 is distinct from row(p.plan_key,p.version,p.display_name,p.active_quests_limit,p.team_members_limit,p.trial_duration_days)) then
 raise exception 'published catalog mismatch' using errcode='23514'; end if;
 definition:=pg_get_functiondef('public.publish_tariff_draft(uuid,uuid,integer,timestamptz)'::regprocedure);
 marker:='insert into public.billing_tariff_timeline(version_id,fixed_version_id,plan_key,effective_at)';
 if position(marker in definition)=0 then raise exception 'publication catalog marker missing'; end if;
 execute replace(definition,marker,'insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at)
 select id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at
 from public.platform_fixed_tariff_versions where id=snapshot_id;
 '||marker);
end; $$;
commit;
