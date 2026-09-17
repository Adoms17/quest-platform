-- Включение только явной серверной операцией для выбранной организации.
alter table public.organization_subscriptions
  add column active_quest_quota_enabled boolean not null default false;

create function public.enforce_active_quest_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  quota integer;
  usage bigint;
begin
  if new.is_open is distinct from true then return null; end if;
  if tg_op='UPDATE' then
    if old.is_open is true and old.organization_id is not distinct from new.organization_id then return null; end if;
  end if;
  -- Одна блокировка на организацию сериализует открытия и смену её тарифа.
  select * into subscription from public.organization_subscriptions
    where organization_id=new.organization_id for update;
  if not coalesce(subscription.active_quest_quota_enabled,false) or subscription.status='transition' then return null; end if;
  -- Для snapshot isolation нельзя считать расход по устаревшему снимку.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'quest quota requires read committed' using errcode='40001';
  end if;
  select p.active_quests_limit into quota from public.billing_plan_versions p
    where p.id=subscription.plan_version_id and (
      (subscription.status='free' and p.plan_key='free')
      or (subscription.status in ('active','trial')
        and statement_timestamp() >= subscription.period_start and statement_timestamp() < subscription.period_end)
    );
  if quota is null then
    raise exception 'quest quota unavailable' using errcode='P0001';
  end if;
  select count(*) into usage from public.quests where organization_id=new.organization_id and is_open is true;
  if usage > quota then
    raise exception 'active quest quota exceeded' using errcode='P0001';
  end if;
  return null;
end;
$$;
revoke all on function public.enforce_active_quest_quota() from public,anon,authenticated;
create trigger enforce_active_quest_quota
  after insert or update of is_open, organization_id on public.quests
  for each row execute function public.enforce_active_quest_quota();
comment on column public.organization_subscriptions.active_quest_quota_enabled is
  'Явный opt-in сервером. По умолчанию выключен; transition сохраняет прежние возможности. Включение не закрывает квесты автоматически.';
