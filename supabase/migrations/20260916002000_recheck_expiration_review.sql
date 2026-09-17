create table public.billing_review_resolutions (
  confirmation_id uuid primary key references public.billing_confirmation_inbox(confirmation_id) on delete cascade,
  before_state jsonb not null,
  result jsonb not null,
  resolved_at timestamptz not null default clock_timestamp()
);
alter table public.billing_review_resolutions enable row level security;
revoke all on public.billing_review_resolutions from public,anon,authenticated;

create function public.recheck_expiration_billing_review(p_confirmation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.billing_confirmation_inbox%rowtype; s public.organization_subscriptions%rowtype;
  e public.billing_expiration_events%rowtype; resolution public.billing_review_resolutions%rowtype; response jsonb;
begin
  if p_confirmation_id is null then raise exception 'invalid billing confirmation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text,7350));
  select * into resolution from public.billing_review_resolutions where confirmation_id=p_confirmation_id;
  if found then return resolution.result; end if;
  select * into item from public.billing_confirmation_inbox where confirmation_id=p_confirmation_id for update;
  if not found then raise exception 'billing confirmation missing' using errcode='P0001'; end if;
  if item.state<>'review' or item.reason is distinct from 'revision_conflict' then
    raise exception 'billing review not eligible' using errcode='22023'; end if;
  select * into s from public.organization_subscriptions where organization_id=item.organization_id for update;
  select * into e from public.billing_expiration_events where organization_id=item.organization_id and source_revision=item.expected_revision;
  if not found or s.status is distinct from 'expired' or coalesce(e.before_state->>'status','') not in ('active','trial')
    or e.before_state->>'revision' is distinct from item.expected_revision::text
    or e.after_state->>'revision' is distinct from (item.expected_revision+1)::text
    or e.after_state is distinct from to_jsonb(s)
    or (e.before_state-'status'-'revision') is distinct from (e.after_state-'status'-'revision') then
    raise exception 'billing review evidence mismatch' using errcode='40001'; end if;
  response:=public.confirm_organization_subscription_period(item.organization_id,item.confirmation_id,item.expected_revision,
    item.plan_version_id,item.period_start,item.period_end);
  update public.billing_confirmation_inbox set state='applied',reason=null,result=response,checked_at=clock_timestamp()
    where confirmation_id=p_confirmation_id;
  insert into public.billing_review_resolutions(confirmation_id,before_state,result) values(p_confirmation_id,to_jsonb(item),response);
  return response;
end;
$$;
revoke all on function public.recheck_expiration_billing_review(uuid) from public,anon,authenticated;
grant execute on function public.recheck_expiration_billing_review(uuid) to service_role;
comment on function public.recheck_expiration_billing_review(uuid) is
  'Явный служебный вызов для legacy review/revision_conflict после доказанного единственного истечения. Не сбрасывает произвольные конфликты. Все изменения и аудит атомарны.';
