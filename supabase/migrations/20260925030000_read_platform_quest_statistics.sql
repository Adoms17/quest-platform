begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check
 check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read','billing.campaign.draft','billing.campaign.issue','billing.payment.read','billing.refund.preview','organization.quests.read','organization.participants.read','organization.statistics.read'));
insert into public.platform_role_permissions values ('owner','organization.statistics.read'),('operations','organization.statistics.read');
alter table public.platform_audit_events drop constraint platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check
 check(action in ('assignment.created','assignment.updated','organization.summary.read','assignment.grant','assignment.revoke','support.open','support.close','organization.search','organization.quests.read','organization.participants.read','organization.statistics.read'));
create index quest_attempts_statistics_started_idx on public.quest_attempts(started_at,quest_id) where started_at is not null;

create function public.read_platform_quest_statistics(p_from date,p_to date,p_grain text default 'day',p_organization_id uuid default null,p_modes text[] default array['online','hybrid','secure_online'])
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; first_bucket timestamp; last_bucket timestamp; step interval; lower_bound timestamptz; upper_bound timestamptz; report jsonb; modes text[]; zero_counts jsonb;
begin
 if p_organization_id is not null then
  assignment:=public.require_platform_permission('organization.statistics.read',p_organization_id);
  if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 else
  -- A scoped assignment never permits platform-wide totals, even without personal fields.
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'platform access denied' using errcode='42501'; end if;
  select a.id into assignment from public.platform_access_assignments a
   join public.platform_role_permissions p on p.role_key=a.role_key and p.permission_key='organization.statistics.read'
   where a.user_id=auth.uid() and a.scope_kind='platform' and a.revoked_at is null
    and a.valid_from<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp()) order by a.id limit 1;
  if assignment is null then raise exception 'platform access denied' using errcode='42501'; end if;
 end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from
  or p_to-p_from>3660 or p_grain is null or p_grain not in ('day','week','month')
 then raise exception 'invalid statistics period' using errcode='22023'; end if;
 if p_modes is null or cardinality(p_modes)=0 or cardinality(p_modes)>3 or array_ndims(p_modes)<>1
  or exists(select 1 from unnest(p_modes)m where m is null or m not in ('online','hybrid','secure_online'))
 then raise exception 'invalid statistics modes' using errcode='22023'; end if;
 select array_agg(m order by m) into modes from (select distinct unnest(p_modes)m)x;
 zero_counts:='{"unique_participants":0,"started_attempts":0,"in_progress":0,"stalled":0,"early_finished":0,"finished_attempts":0,"started_quests":0,"active_organizations":0}'::jsonb;
 first_bucket:=date_trunc(p_grain,p_from::timestamp); last_bucket:=date_trunc(p_grain,p_to::timestamp);
 step:=case p_grain when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end;
 if (select count(*) from generate_series(first_bucket,last_bucket,step))>366 then raise exception 'too many statistics intervals' using errcode='22023'; end if;
 lower_bound:=p_from::timestamp at time zone 'Europe/Moscow'; upper_bound:=(p_to+1)::timestamp at time zone 'Europe/Moscow';
 with attempts as materialized (
  select a.participant_profile_id,a.quest_id,q.organization_id,q.verification_mode mode,
   date_trunc(p_grain,a.started_at at time zone 'Europe/Moscow') bucket,
   coalesce(activity.is_estimated,true) is_estimated,
   case when a.finished_at is not null then
     case when a.total_tasks>0 and coalesce(a.completed_tasks,0)+coalesce(a.failed_tasks,0)>=a.total_tasks then 'finished_attempts' else 'early_finished' end
    when coalesce(activity.last_activity_at,a.created_at,a.started_at,'-infinity'::timestamptz)>statement_timestamp()-interval '24 hours' then 'in_progress'
    else 'stalled' end state
  from public.quest_attempts a join public.quests q on q.id=a.quest_id
  left join public.quest_attempt_activity activity on activity.quest_attempt_id=a.id
  where a.started_at>=lower_bound and a.started_at<upper_bound
   and (p_organization_id is null or q.organization_id=p_organization_id) and q.verification_mode=any(modes)
 ), aggregates as (
  select bucket,mode,grouping(bucket) bucket_total,grouping(mode) mode_total,
   count(distinct participant_profile_id) unique_participants,count(*) started_attempts,
   count(*) filter(where state='in_progress') in_progress,count(*) filter(where state='stalled') stalled,
   count(*) filter(where state='early_finished') early_finished,count(*) filter(where state='finished_attempts') finished_attempts,
   count(distinct quest_id) started_quests,count(distinct organization_id) active_organizations
  from attempts group by grouping sets ((bucket,mode),(bucket),(mode),())
 ), counts as (
  select bucket,mode,bucket_total,mode_total,to_jsonb(a)-'bucket'-'mode'-'bucket_total'-'mode_total' metrics from aggregates a
 ), buckets as (
  select b,jsonb_build_object('from',greatest(b::date,p_from),'to',least((b+step)::date-1,p_to))
   ||coalesce(a.metrics,zero_counts)||jsonb_build_object('by_mode',(
    select jsonb_agg(jsonb_build_object('mode',m)||coalesce(c.metrics,zero_counts) order by m)
    from unnest(modes)m left join counts c on c.mode=m and c.bucket=b and c.mode_total=0 and c.bucket_total=0
   )) item
  from generate_series(first_bucket,last_bucket,step)b left join counts a on a.bucket=b and a.bucket_total=0 and a.mode_total=1
 ) select jsonb_build_object('from',p_from,'to',p_to,'grain',p_grain,'timezone','Europe/Moscow','modes',modes,
  'measured_at',statement_timestamp(),'activity_history_partial',exists(select 1 from attempts where is_estimated),
  'summary',(select metrics from counts where bucket_total=1 and mode_total=1),
  'by_mode',(select jsonb_agg(jsonb_build_object('mode',m)||coalesce(c.metrics,zero_counts) order by m)
    from unnest(modes)m left join counts c on c.mode=m and c.bucket_total=1 and c.mode_total=0),
  'items',(select jsonb_agg(item order by b) from buckets)) into report;
 insert into public.platform_audit_events(actor_id,assignment_id,organization_id,action)
 values(auth.uid(),assignment,p_organization_id,'organization.statistics.read');
 return report;
end; $$;
revoke all on function public.read_platform_quest_statistics(date,date,text,uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_quest_statistics(date,date,text,uuid,text[]) to authenticated;
commit;
