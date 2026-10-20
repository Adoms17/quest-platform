-- Только новые серверные регистрации; исторические started_at не являются
-- достоверным временем первой доставки offline-попытки.
create table public.participant_usage_registrations (
  server_attempt_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  participant_profile_id uuid not null,
  registered_at timestamptz not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  check (isfinite(registered_at) and period_start <= registered_at and registered_at < period_end)
);
create index participant_usage_period_profile_idx on public.participant_usage_registrations
  (organization_id, period_start, participant_profile_id);
alter table public.participant_usage_registrations enable row level security;
revoke all on public.participant_usage_registrations from public, anon, authenticated;
comment on table public.participant_usage_registrations is
  'Закрытые факты регистрации для будущего агрегата billing.read. Нет FK на попытку/профиль: удаление результатов не удаляет факт. Объединение профилей учитывается отдельно. Списки клиенту не выдаются.';

create function public.record_participant_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  registered timestamptz := statement_timestamp();
  month_start timestamp := date_trunc('month', registered at time zone 'Europe/Moscow');
begin
  insert into public.participant_usage_registrations
    (server_attempt_id, organization_id, participant_profile_id, registered_at, period_start, period_end)
  select new.id, q.organization_id, new.participant_profile_id, registered,
    month_start at time zone 'Europe/Moscow',
    (month_start + interval '1 month') at time zone 'Europe/Moscow'
  from public.quests q where q.id = new.quest_id
  on conflict (server_attempt_id) do nothing;
  return null;
end;
$$;
revoke all on function public.record_participant_usage() from public, anon, authenticated;
create trigger record_participant_usage after insert on public.quest_attempts
  for each row execute function public.record_participant_usage();
