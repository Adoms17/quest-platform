begin;
create extension if not exists pg_cron;

create table public.billing_lifecycle_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  result jsonb not null
);
alter table public.billing_lifecycle_runs enable row level security;
revoke all on public.billing_lifecycle_runs from public, anon, authenticated;

create function public.run_billing_lifecycle(p_batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp(); confirmations jsonb; expirations jsonb;
  candidate record; evaluated integer:=0; result jsonb; run_id bigint;
begin
  if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then
    raise exception 'invalid billing batch size' using errcode='22023'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'billing lifecycle requires read committed' using errcode='40001'; end if;
  if not pg_try_advisory_xact_lock(16010000,1) then
    return jsonb_build_object('busy',true);
  end if;
  -- Сначала уже проверенные подтверждения; затем техническое истечение.
  confirmations:=public.process_due_billing_confirmations(p_batch_size);
  expirations:=public.process_subscription_expirations(p_batch_size);
  for candidate in
    select s.organization_id from public.organization_subscriptions s
    where (s.cancel_at_period_end or s.scheduled_plan_version_id is not null)
      and (s.cancel_intent_stale or s.scheduled_intent_stale or s.period_end<=clock_timestamp())
      and not exists(select 1 from public.billing_intent_evaluations e
        where e.organization_id=s.organization_id and e.subscription_revision=s.revision)
    order by s.period_end,s.organization_id limit p_batch_size for update of s skip locked
  loop
    perform public.evaluate_organization_billing_intent(candidate.organization_id);
    evaluated:=evaluated+1;
  end loop;
  result:=jsonb_build_object('busy',false,'confirmations',confirmations,
    'expirations',expirations,'evaluated_intents',evaluated);
  insert into public.billing_lifecycle_runs(started_at,finished_at,result)
    values(started,clock_timestamp(),result) returning id into run_id;
  return result||jsonb_build_object('run_id',run_id);
end;
$$;
revoke all on function public.run_billing_lifecycle(integer) from public,anon,authenticated;
grant execute on function public.run_billing_lifecycle(integer) to service_role;

-- Расписание подготовлено, но не включается миграцией для реальных организаций.
-- Включение — часть отдельного rollout; ошибка транзакции видна в cron.job_run_details.
select cron.schedule('quest-billing-lifecycle','* * * * *',
  $job$set statement_timeout='45s'; set lock_timeout='5s'; select public.run_billing_lifecycle(100);$job$);
select cron.alter_job((select jobid from cron.job where jobname='quest-billing-lifecycle'),active:=false);
comment on function public.run_billing_lifecycle(integer) is
 'Закрытая атомарная ограниченная пачка: подтверждения, истечение, аудит намерений. Повтор безопасен; параллельный runner возвращает busy. Не подтверждает оплату и не исполняет автоплатежи. Расписание выключено до rollout.';
commit;
