alter table public.organization_subscriptions
  add column cancel_source_plan_version_id uuid references public.billing_plan_versions(id),
  add column cancel_source_period_start timestamptz,
  add column cancel_source_period_end timestamptz,
  add column cancel_intent_stale boolean not null default false;
-- У ранее записанного намерения нет доказанного снимка исходных условий.
update public.organization_subscriptions set cancel_intent_stale=true where cancel_at_period_end;

create function public.bind_cancel_billing_intent() returns trigger
language plpgsql set search_path='' as $$
begin
  if not new.cancel_at_period_end then
    new.cancel_source_plan_version_id:=null;
    new.cancel_source_period_start:=null;
    new.cancel_source_period_end:=null;
    new.cancel_intent_stale:=false;
  elsif not old.cancel_at_period_end then
    new.cancel_source_plan_version_id:=new.plan_version_id;
    new.cancel_source_period_start:=new.period_start;
    new.cancel_source_period_end:=new.period_end;
    new.cancel_intent_stale:=new.plan_version_id is distinct from old.plan_version_id
      or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end;
  else
    new.cancel_source_plan_version_id:=old.cancel_source_plan_version_id;
    new.cancel_source_period_start:=old.cancel_source_period_start;
    new.cancel_source_period_end:=old.cancel_source_period_end;
    new.cancel_intent_stale:=old.cancel_intent_stale
      or new.plan_version_id is distinct from old.plan_version_id
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
      or new.status not in ('active','expired');
  end if;
  return new;
end;
$$;
revoke all on function public.bind_cancel_billing_intent() from public,anon,authenticated;
-- До bump_subscription_revision: изменение снимка входит в новую версию.
create trigger a_bind_cancel_billing_intent before update on public.organization_subscriptions
  for each row execute function public.bind_cancel_billing_intent();

create or replace function public.get_organization_billing_intent(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; intent_state text; cancel_state text;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.read') then
    raise exception 'billing access denied' using errcode='42501';
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  intent_state:=case
    when s.scheduled_plan_version_id is null then 'none'
    when s.scheduled_intent_stale or s.scheduled_source_plan_version_id is null
      or s.scheduled_source_period_start is null or s.scheduled_source_period_end is null
      or s.scheduled_source_plan_version_id is distinct from s.plan_version_id
      or s.scheduled_source_period_start is distinct from s.period_start
      or s.scheduled_source_period_end is distinct from s.period_end
      or s.scheduled_effective_at is distinct from s.period_end
      or s.status not in ('active','expired') then 'stale'
    when statement_timestamp()>=s.scheduled_effective_at then 'due'
    else 'scheduled' end;
  cancel_state:=case
    when not s.cancel_at_period_end then 'none'
    when s.cancel_intent_stale or s.cancel_source_plan_version_id is null
      or s.cancel_source_period_start is null or s.cancel_source_period_end is null
      or s.cancel_source_plan_version_id is distinct from s.plan_version_id
      or s.cancel_source_period_start is distinct from s.period_start
      or s.cancel_source_period_end is distinct from s.period_end
      or s.status not in ('active','expired') then 'stale'
    when statement_timestamp()>=s.cancel_source_period_end then 'due'
    else 'scheduled' end;
  return jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,
    'cancel_at_period_end',s.cancel_at_period_end,'scheduled_plan_version_id',s.scheduled_plan_version_id,
    'scheduled_effective_at',s.scheduled_effective_at,'period_end',s.period_end,
    'scheduled_intent_state',intent_state,'cancel_intent_state',cancel_state,
    'cancel_source_plan_version_id',s.cancel_source_plan_version_id,
    'cancel_source_period_start',s.cancel_source_period_start,'cancel_source_period_end',s.cancel_source_period_end,
    'scheduled_source_plan_version_id',s.scheduled_source_plan_version_id,
    'scheduled_source_period_start',s.scheduled_source_period_start,'scheduled_source_period_end',s.scheduled_source_period_end);
end;
$$;
comment on function public.get_organization_billing_intent(uuid) is
  'Чтение актуального намерения: none/scheduled/due/stale. due не означает исполнение или подтверждение оплаты. Исполнитель обязан повторно проверить снимок под блокировкой.';
