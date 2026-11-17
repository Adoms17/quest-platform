-- 6A-02.1: каталог условий; подключение организаций и enforcement — отдельно.
create table public.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null check (plan_key ~ '^[a-z][a-z0-9_]*$'),
  version integer not null check (version > 0),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  active_quests_limit integer not null check (active_quests_limit >= 0),
  team_members_limit integer not null check (team_members_limit >= 1),
  created_at timestamptz not null default now(),
  unique (plan_key, version)
);

comment on table public.billing_plan_versions is
  'Неизменяемые версии тарифных условий. Наличие версии не назначает тариф, роль или квоту организации. Цены и коммерческий lifecycle пока не определены.';
comment on column public.billing_plan_versions.active_quests_limit is
  'Квесты организации с is_open=true, независимо от расписания и публичности.';
comment on column public.billing_plan_versions.team_members_limit is
  'Уникальные активные аккаунты команды, включая владельца; приглашения не резервируют место.';

alter table public.billing_plan_versions enable row level security;
revoke all on public.billing_plan_versions from anon, authenticated;
grant select on public.billing_plan_versions to authenticated;
create policy billing_plan_versions_read on public.billing_plan_versions
  for select to authenticated using (true);

-- Даже сервер не переписывает ранее выданную версию: изменение = новая строка.
create function public.prevent_billing_plan_version_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'billing plan versions are immutable' using errcode = '55000';
end;
$$;
revoke all on function public.prevent_billing_plan_version_mutation() from public, anon, authenticated;
create trigger billing_plan_versions_immutable
  before update or delete or truncate on public.billing_plan_versions
  for each statement execute function public.prevent_billing_plan_version_mutation();

insert into public.billing_plan_versions
  (plan_key, version, display_name, active_quests_limit, team_members_limit)
values ('free', 1, 'Free', 1, 1), ('pro', 1, 'Pro', 5, 3), ('business', 1, 'Business', 20, 10);
