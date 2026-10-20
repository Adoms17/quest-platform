-- Независимый opt-in: существующим организациям квота не включается.
alter table public.organization_subscriptions
  add column team_member_quota_enabled boolean not null default false;

create function public.enforce_team_member_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  subscription public.organization_subscriptions%rowtype;
  quota integer;
  usage bigint;
begin
  if new.status <> 'active' then return null; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'active' and old.organization_id = new.organization_id then return null; end if;
  end if;
  select * into subscription from public.organization_subscriptions
    where organization_id = new.organization_id for update;
  if not coalesce(subscription.team_member_quota_enabled, false) or subscription.status = 'transition' then return null; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'team quota requires read committed' using errcode = '40001';
  end if;
  select p.team_members_limit into quota from public.billing_plan_versions p
    where p.id = subscription.plan_version_id and (
      (subscription.status = 'free' and p.plan_key = 'free')
      or (subscription.status in ('active', 'trial')
        and statement_timestamp() >= subscription.period_start and statement_timestamp() < subscription.period_end)
    );
  if quota is null then raise exception 'team quota unavailable' using errcode = 'P0001'; end if;
  select count(distinct user_id) into usage from public.organization_memberships
    where organization_id = new.organization_id and status = 'active';
  if usage > quota then raise exception 'team member quota exceeded' using errcode = 'P0001'; end if;
  return null;
end;
$$;
revoke all on function public.enforce_team_member_quota() from public, anon, authenticated;
create trigger enforce_team_member_quota
  after insert or update of status, organization_id on public.organization_memberships
  for each row execute function public.enforce_team_member_quota();
comment on column public.organization_subscriptions.team_member_quota_enabled is
  'Серверный opt-in квоты активных аккаунтов с владельцем. Transition исключён. Не отзывает существующее членство; приглашения не резервируют места.';
