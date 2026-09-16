create index billing_confirmation_inbox_due_idx on public.billing_confirmation_inbox(period_start,confirmation_id)
  where state in ('pending','deferred');

create function public.process_due_billing_confirmations(p_batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; outcome jsonb; scanned integer:=0; processed integer:=0; busy integer:=0;
  cutoff timestamptz:=clock_timestamp();
begin
  if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then
    raise exception 'invalid billing batch size' using errcode='22023'; end if;
  for candidate in select confirmation_id from public.billing_confirmation_inbox
    where state in ('pending','deferred') and period_start<=cutoff
    order by period_start,confirmation_id limit p_batch_size
  loop
    scanned:=scanned+1;
    -- Тот же порядок блокировок, что у одиночной обработки: ID, затем строка.
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.confirmation_id::text,7350)) then
      busy:=busy+1; continue;
    end if;
    outcome:=public.process_billing_confirmation(candidate.confirmation_id);
    if outcome->>'state' in ('applied','review') then processed:=processed+1; end if;
  end loop;
  return jsonb_build_object('scanned',scanned,'processed',processed,'busy',busy,'cutoff',cutoff);
end;
$$;
create function public.get_billing_confirmation_queue_summary()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('pending',count(*) filter(where state='pending'),
    'deferred',count(*) filter(where state='deferred'),'review',count(*) filter(where state='review'),
    'due',count(*) filter(where state in ('pending','deferred') and period_start<=statement_timestamp()),
    'oldest_review_at',min(received_at) filter(where state='review'),'measured_at',statement_timestamp())
    from public.billing_confirmation_inbox where state<>'applied';
$$;
revoke all on function public.process_due_billing_confirmations(integer) from public,anon,authenticated;
revoke all on function public.get_billing_confirmation_queue_summary() from public,anon,authenticated;
grant execute on function public.process_due_billing_confirmations(integer) to service_role;
grant execute on function public.get_billing_confirmation_queue_summary() to service_role;
comment on function public.process_due_billing_confirmations(integer) is
  'Одна ограниченная пачка. review не возобновляется автоматически. Ноль processed не означает пустую очередь: есть busy. Внешнее расписание не включено.';
