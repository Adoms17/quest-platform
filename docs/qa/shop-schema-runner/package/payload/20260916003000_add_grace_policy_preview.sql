-- 6C: политика согласована, включение ограничений остаётся отдельным срезом.
begin;
create table public.billing_lifecycle_policy_versions (
  version integer primary key check(version > 0),
  grace_hours integer not null check(grace_hours >= 0 and grace_hours <= 8760),
  grace_after_cancellation boolean not null,
  created_at timestamptz not null default now()
);
alter table public.billing_lifecycle_policy_versions enable row level security;
revoke all on public.billing_lifecycle_policy_versions from public, anon, authenticated;
create function public.prevent_billing_lifecycle_policy_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'billing lifecycle policies are immutable' using errcode='55000';
end;
$$;
revoke all on function public.prevent_billing_lifecycle_policy_mutation() from public,anon,authenticated;
create trigger billing_lifecycle_policy_immutable before update or delete or truncate
on public.billing_lifecycle_policy_versions for each statement
execute function public.prevent_billing_lifecycle_policy_mutation();
insert into public.billing_lifecycle_policy_versions(version,grace_hours,grace_after_cancellation)
values(1,120,true);

-- Внутренний расчёт допускает заданное время для проверки точных границ.
-- Не является проверкой permissions, доступа к квесту или наличия свободной квоты.
create function public.evaluate_billing_lifecycle_policy(
  p_status text, p_period_start timestamptz, p_period_end timestamptz,
  p_cancelled boolean, p_paid_expiration boolean, p_policy_version integer,
  p_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare policy public.billing_lifecycle_policy_versions%rowtype;
  phase text; grace_end timestamptz; allowed boolean;
begin
  if p_at is null or not isfinite(p_at) then
    raise exception 'invalid billing evaluation time' using errcode='22023';
  end if;
  select * into policy from public.billing_lifecycle_policy_versions where version=p_policy_version;
  if not found then raise exception 'billing lifecycle policy missing' using errcode='22023'; end if;
  phase:=coalesce(p_status,'missing');
  if phase not in ('missing','unconfigured','transition','free','trial','active','expired') then
    phase:='invalid';
  elsif phase in ('active','trial','expired') then
    if p_period_start is null or p_period_end is null or not isfinite(p_period_start)
      or not isfinite(p_period_end) or p_period_start >= p_period_end then
      phase:='invalid';
    else
      if (p_status='active' or (p_status='expired' and p_paid_expiration is true))
        and (p_cancelled is false or policy.grace_after_cancellation) then
        -- Часы, а не календарные дни: результат не зависит от DST.
        grace_end:=p_period_end + make_interval(hours=>policy.grace_hours);
      end if;
      if p_status <> 'expired' and p_at < p_period_start then phase:='not_started';
      elsif p_at >= p_period_end then
        phase:=case when grace_end is not null and p_at < grace_end then 'grace' else 'expired' end;
      end if;
    end if;
  end if;
  allowed:=phase in ('free','active','trial','grace','transition');
  return jsonb_build_object('policy_version',policy.version,'phase',phase,
    'grace_end',grace_end,'measured_at',p_at,
    'billing_allows_new_start',allowed,'billing_allows_resource_increase',allowed,
    'billing_blocks_existing_attempt_sync',false,'policy_enforced',false);
end;
$$;
revoke all on function public.evaluate_billing_lifecycle_policy(text,timestamptz,timestamptz,boolean,boolean,integer,timestamptz)
from public,anon,authenticated;
grant execute on function public.evaluate_billing_lifecycle_policy(text,timestamptz,timestamptz,boolean,boolean,integer,timestamptz) to service_role;

create function public.preview_organization_billing_lifecycle(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; paid_expiration boolean:=false; state text;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.read') then
    raise exception 'billing access denied' using errcode='42501';
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id;
  state:=coalesce(s.status,'missing');
  if state='free' and not exists(select 1 from public.billing_plan_versions where id=s.plan_version_id and plan_key='free') then
    state:='invalid';
  end if;
  -- Только доказанное техническое истечение оплаченного периода, не истёкший trial.
  if state='expired' then
    select exists(select 1 from public.billing_expiration_events e
      where e.organization_id=p_organization_id and e.before_state->>'status'='active'
      and e.after_state=to_jsonb(s)) into paid_expiration;
  end if;
  return public.evaluate_billing_lifecycle_policy(state,s.period_start,s.period_end,
    s.cancel_at_period_end,paid_expiration,1,statement_timestamp())
    || jsonb_build_object('organization_id',p_organization_id,'subscription_revision',s.revision,
      'stored_status',s.status,'preview_only',true);
end;
$$;
revoke all on function public.preview_organization_billing_lifecycle(uuid) from public,anon,authenticated;
grant execute on function public.preview_organization_billing_lifecycle(uuid) to authenticated;
comment on function public.preview_organization_billing_lifecycle(uuid) is
  'Предварительный расчёт политики v1: grace 120 часов. Не подключён к квотам/стартам, не назначает политику организациям. При изменении подписки после технического истечения требуется повторная сверка происхождения; без доказательства grace не выдаётся.';
commit;
