create index organization_subscriptions_due_idx on public.organization_subscriptions(period_end,organization_id)
  where status in ('active','trial');

create function public.process_subscription_expirations(p_batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; processed integer:=0; scanned integer:=0; result jsonb;
  cutoff timestamptz:=clock_timestamp();
begin
  if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then
    raise exception 'invalid billing batch size' using errcode='22023';
  end if;
  for candidate in
    select organization_id,revision from public.organization_subscriptions
      where status in ('active','trial') and period_end<=cutoff
      order by period_end,organization_id limit p_batch_size for update skip locked
  loop
    scanned:=scanned+1;
    result:=public.record_organization_subscription_expiration(candidate.organization_id,candidate.revision);
    if (result->>'recorded')::boolean then processed:=processed+1; end if;
  end loop;
  return jsonb_build_object('scanned',scanned,'processed',processed,'batch_size',p_batch_size,'cutoff',cutoff);
end;
$$;
revoke all on function public.process_subscription_expirations(integer) from public,anon,authenticated;
grant execute on function public.process_subscription_expirations(integer) to service_role;
comment on function public.process_subscription_expirations(integer) is
  'Одна атомарная пачка 1..500; SKIP LOCKED. Ноль не гарантирует отсутствие занятых строк. Повтор обрабатывает оставшиеся, не возвращает прежнюю пачку. Расписание не включено.';
