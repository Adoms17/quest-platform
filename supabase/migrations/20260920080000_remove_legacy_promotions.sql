begin;
-- Сначала остановиться, если сведения о неиспользуемой старой модели неверны.
-- Связанная подписка должна быть разобрана явно, а не удалена каскадом.
do $$begin
 if exists(select 1 from public.billing_trial_access where access_kind='promotion') then
 raise exception 'legacy promotion access must be resolved before removal' using errcode='55000'; end if;
end; $$;
drop function public.preview_organization_promotion(uuid,text);
drop function public.redeem_organization_promotion(uuid,text,uuid,bigint);
drop function public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid);
drop function public.revoke_organization_promotion(uuid);
create or replace function public.initialize_billing_free_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare usage public.billing_trial_usage%rowtype;
begin
 select * into usage from public.billing_trial_usage where id=new.id;
 if new.access_kind<>'trial' or not found or usage.organization_id<>new.organization_id or usage.plan_version_id<>new.plan_version_id then
 raise exception 'invalid trial access source' using errcode='23514'; end if;
 new.duration_days:=usage.trial_duration_days;
 return new;
end; $$;
do $migration$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.get_free_access_command_result(uuid,text,uuid)'::regprocedure);
 marker:='elsif p_kind=''promotion'' then';
 if position(marker in definition)=0 then raise exception 'legacy promotion receipt marker missing'; end if;
 definition:=regexp_replace(definition,'elsif p_kind=''promotion'' then[\s\S]*?elsif p_kind=''reconfirm'' then','elsif p_kind=''reconfirm'' then');
 if position(marker in definition)>0 then raise exception 'legacy receipt removal failed'; end if;
 execute definition;
end;
$migration$;
alter table public.billing_trial_access drop constraint billing_access_source_shape;
alter table public.billing_trial_access drop column promotion_id;
alter table public.billing_trial_access add constraint billing_access_trial_only check(access_kind='trial');
drop table public.billing_promotions;
drop table public.billing_promotion_commands;
drop table public.billing_promotion_rate_limits;
commit;
