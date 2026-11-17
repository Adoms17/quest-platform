create table public.billing_expiration_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_revision bigint not null,
  before_state jsonb not null,
  after_state jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,source_revision)
);
alter table public.billing_expiration_events enable row level security;
revoke all on public.billing_expiration_events from public,anon,authenticated;

create function public.record_organization_subscription_expiration(p_organization_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; previous jsonb; event public.billing_expiration_events%rowtype;
begin
  if p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid billing revision' using errcode='22023';
  end if;
  select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
  if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
  select * into event from public.billing_expiration_events where organization_id=p_organization_id and source_revision=p_expected_revision;
  if found then
    return jsonb_build_object('recorded',true,'source_revision',event.source_revision,'result_revision',event.after_state->'revision','recorded_at',event.recorded_at);
  end if;
  if s.revision<>p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
  if s.status not in ('active','trial') or s.period_end is null or not isfinite(s.period_end)
    or clock_timestamp()<s.period_end then
    return jsonb_build_object('recorded',false,'source_revision',s.revision);
  end if;
  previous:=to_jsonb(s);
  update public.organization_subscriptions set status='expired' where organization_id=p_organization_id returning * into s;
  insert into public.billing_expiration_events(organization_id,source_revision,before_state,after_state)
    values(p_organization_id,p_expected_revision,previous,to_jsonb(s)) returning * into event;
  return jsonb_build_object('recorded',true,'source_revision',event.source_revision,'result_revision',s.revision,'recorded_at',event.recorded_at);
end;
$$;
revoke all on function public.record_organization_subscription_expiration(uuid,bigint) from public,anon,authenticated;
grant execute on function public.record_organization_subscription_expiration(uuid,bigint) to service_role;
comment on function public.record_organization_subscription_expiration(uuid,bigint) is
  'Фиксация уже наступившего истечения, не смена плана/квот. Retry возвращает исторический receipt, не актуальный статус. Планировщик не подключён.';
