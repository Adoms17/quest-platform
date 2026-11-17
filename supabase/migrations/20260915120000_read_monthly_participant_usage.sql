create table public.participant_usage_coverage (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null check (isfinite(started_at))
);
-- Консервативное начало гарантированного покрытия: без восстановления истории.
insert into public.participant_usage_coverage(singleton,started_at) values(true,statement_timestamp());
alter table public.participant_usage_coverage enable row level security;
revoke all on public.participant_usage_coverage from public, anon, authenticated;

create function public.get_monthly_participant_usage(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  month_start timestamp := date_trunc('month', statement_timestamp() at time zone 'Europe/Moscow');
  starts timestamptz := month_start at time zone 'Europe/Moscow';
  ends timestamptz := (month_start + interval '1 month') at time zone 'Europe/Moscow';
  coverage timestamptz;
  participants bigint;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.read') then
    raise exception 'billing access denied' using errcode='42501';
  end if;
  select started_at into coverage from public.participant_usage_coverage where singleton;
  if coverage is not null then
    select count(distinct participant_profile_id) into participants
    from public.participant_usage_registrations
    where organization_id=p_organization_id and period_start=starts
      and registered_at >= greatest(starts,coverage) and registered_at < ends;
  end if;
  return jsonb_build_object('organization_id',p_organization_id,
    'period_start',starts,'period_end',ends,'timezone','Europe/Moscow',
    'coverage_started_at',coverage,'is_partial',coverage is null or coverage > starts,
    'participants',participants,'enforcement_enabled',false,'measured_at',statement_timestamp());
end;
$$;
revoke all on function public.get_monthly_participant_usage(uuid) from public, anon, authenticated;
grant execute on function public.get_monthly_participant_usage(uuid) to authenticated;
comment on function public.get_monthly_participant_usage(uuid) is
  'Наблюдение текущего месяца по исходным ID профилей, без лимита/доплаты. Неполное покрытие отмечено явно; объединение профилей и offline-связь ещё требуют отдельной реализации.';
