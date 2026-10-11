alter table public.organization_subscriptions
  add column revision bigint not null default 0 check(revision>=0),
  add column cancel_at_period_end boolean not null default false,
  add column scheduled_plan_version_id uuid references public.billing_plan_versions(id),
  add column scheduled_effective_at timestamptz,
  add constraint billing_scheduled_shape check(
    (scheduled_plan_version_id is null and scheduled_effective_at is null)
    or (scheduled_plan_version_id is not null and scheduled_effective_at is not null and isfinite(scheduled_effective_at))
  ),
  add constraint billing_exclusive_intents check(not(cancel_at_period_end and scheduled_plan_version_id is not null));

create function public.bump_subscription_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'revision') is distinct from (to_jsonb(old)-'revision') then
    new.revision:=old.revision+1;
  else new.revision:=old.revision; end if;
  return new;
end;
$$;
revoke all on function public.bump_subscription_revision() from public,anon,authenticated;
create trigger bump_subscription_revision before update on public.organization_subscriptions
  for each row execute function public.bump_subscription_revision();

create table public.billing_intent_commands(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null,
  command_id uuid not null,
  request jsonb not null,
  before_state jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key(organization_id,actor_id,command_id)
);
alter table public.billing_intent_commands enable row level security;
revoke all on public.billing_intent_commands from public,anon,authenticated;

create function public.get_organization_billing_intent(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.read') then
    raise exception 'billing access denied' using errcode='42501';
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  return jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,
    'cancel_at_period_end',s.cancel_at_period_end,'scheduled_plan_version_id',s.scheduled_plan_version_id,
    'scheduled_effective_at',s.scheduled_effective_at,'period_end',s.period_end);
end;
$$;
revoke all on function public.get_organization_billing_intent(uuid) from public,anon,authenticated;
grant execute on function public.get_organization_billing_intent(uuid) to authenticated;

create function public.request_organization_billing_intent(
  p_organization_id uuid,p_command_id uuid,p_expected_revision bigint,p_action text,p_target_plan_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); s public.organization_subscriptions%rowtype;
  current_plan public.billing_plan_versions%rowtype; target_plan public.billing_plan_versions%rowtype;
  receipt public.billing_intent_commands%rowtype; request jsonb; result jsonb; before_state jsonb;
begin
  if actor is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
    raise exception 'billing management denied' using errcode='42501';
  end if;
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0 or p_action is null
    or p_action not in ('cancel_renewal','resume_renewal','schedule_downgrade','clear_downgrade')
    or (p_action='schedule_downgrade')<>(p_target_plan_version_id is not null) then
    raise exception 'invalid billing command' using errcode='22023';
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  request:=jsonb_build_object('action',p_action,'expected_revision',p_expected_revision,'target',p_target_plan_version_id);
  select * into receipt from public.billing_intent_commands
    where organization_id=p_organization_id and actor_id=actor and command_id=p_command_id;
  if found then
    if receipt.request<>request then raise exception 'billing command conflict' using errcode='22023'; end if;
    return receipt.result;
  end if;
  if s.revision<>p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
  if s.status<>'active' or s.period_start is null or s.period_end is null
    or statement_timestamp()<s.period_start or statement_timestamp()>=s.period_end then
    raise exception 'billing period not active' using errcode='P0001';
  end if;
  before_state:=to_jsonb(s);
  if p_action='schedule_downgrade' then
    if s.cancel_at_period_end then raise exception 'billing intent conflict' using errcode='P0001'; end if;
    select * into current_plan from public.billing_plan_versions where id=s.plan_version_id;
    select * into target_plan from public.billing_plan_versions where id=p_target_plan_version_id;
    if target_plan.id is null or current_plan.id is null
      or target_plan.active_quests_limit>current_plan.active_quests_limit or target_plan.team_members_limit>current_plan.team_members_limit
      or (target_plan.active_quests_limit=current_plan.active_quests_limit and target_plan.team_members_limit=current_plan.team_members_limit) then
      raise exception 'target is not a downgrade' using errcode='22023';
    end if;
    update public.organization_subscriptions set scheduled_plan_version_id=target_plan.id,scheduled_effective_at=s.period_end where organization_id=p_organization_id;
  elsif p_action='clear_downgrade' then
    update public.organization_subscriptions set scheduled_plan_version_id=null,scheduled_effective_at=null where organization_id=p_organization_id;
  else
    if p_action='cancel_renewal' and s.scheduled_plan_version_id is not null then
      raise exception 'billing intent conflict' using errcode='P0001';
    end if;
    update public.organization_subscriptions set cancel_at_period_end=(p_action='cancel_renewal') where organization_id=p_organization_id;
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id;
  result:=jsonb_build_object('organization_id',s.organization_id,'revision',s.revision,
    'cancel_at_period_end',s.cancel_at_period_end,'scheduled_plan_version_id',s.scheduled_plan_version_id,
    'scheduled_effective_at',s.scheduled_effective_at,'period_end',s.period_end);
  insert into public.billing_intent_commands(organization_id,actor_id,command_id,request,before_state,result)
    values(p_organization_id,actor,p_command_id,request,before_state,result);
  return result;
end;
$$;
revoke all on function public.request_organization_billing_intent(uuid,uuid,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.request_organization_billing_intent(uuid,uuid,bigint,text,uuid) to authenticated;
comment on function public.request_organization_billing_intent(uuid,uuid,bigint,text,uuid) is
  'Намерение владельца, не подтверждение платежа/отмены у провайдера. Не изменяет текущие тариф, период, квоты или старты. Исполнение на границе — отдельный серверный этап.';
