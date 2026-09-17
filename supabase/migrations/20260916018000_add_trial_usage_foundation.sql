-- 6C-02.1: параметры и история trial. Активация подписки подключается отдельно.
begin;

alter table public.billing_plan_versions
  add column trial_duration_days integer not null default 14
    check (trial_duration_days > 0);
comment on column public.billing_plan_versions.trial_duration_days is
  'Длительность trial в сутках по 24 часа. Для Free не применяется. Изменение — новая версия тарифа; существующие подписки не изменяются.';

create table public.billing_trial_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  actor_id uuid not null,
  command_id uuid not null,
  plan_version_id uuid not null references public.billing_plan_versions(id) on delete restrict,
  plan_key text not null,
  device_key_hash text not null check (device_key_hash ~ '^[0-9a-f]{64}$'),
  trial_duration_days integer not null check (trial_duration_days > 0),
  consumed_at timestamptz not null,
  unique (organization_id, plan_key),
  unique (actor_id, plan_key),
  unique (device_key_hash, plan_key),
  unique (actor_id, command_id)
);
comment on table public.billing_trial_usage is
  'Неизменяемая история однократного trial. Нет каскадных FK к аккаунту/организации: удаление не возвращает право на trial. Запись только внутри будущей атомарной активации; сама таблица не выдаёт доступ.';
comment on column public.billing_trial_usage.device_key_hash is
  'Хеш браузерной метки, не доказательство физического устройства. Не хранить сырые признаки, IP или персональные данные.';
alter table public.billing_trial_usage enable row level security;
revoke all on public.billing_trial_usage from public, anon, authenticated, service_role;

create function public.initialize_billing_trial_usage() returns trigger
language plpgsql set search_path = '' as $$
declare selected_plan public.billing_plan_versions%rowtype;
begin
  select * into selected_plan from public.billing_plan_versions where id = new.plan_version_id;
  if not found or selected_plan.plan_key = 'free' then
    raise exception 'trial requires a paid plan' using errcode = '22023';
  end if;
  -- Поля из клиента не могут подменить ключ тарифа, длительность или время.
  new.plan_key := selected_plan.plan_key;
  new.trial_duration_days := selected_plan.trial_duration_days;
  new.consumed_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.initialize_billing_trial_usage() from public, anon, authenticated, service_role;
create trigger initialize_billing_trial_usage before insert on public.billing_trial_usage
  for each row execute function public.initialize_billing_trial_usage();

create function public.prevent_billing_trial_usage_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'trial usage is immutable' using errcode = '55000';
end;
$$;
revoke all on function public.prevent_billing_trial_usage_mutation() from public, anon, authenticated, service_role;
create trigger billing_trial_usage_immutable before update or delete or truncate
  on public.billing_trial_usage for each statement execute function public.prevent_billing_trial_usage_mutation();

commit;
