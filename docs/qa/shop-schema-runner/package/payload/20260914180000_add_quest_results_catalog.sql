-- Краткие серверные результаты; задания и ответы не включаются в каталог.
create index if not exists quest_results_catalog_idx
on public.quest_attempts(quest_id, (coalesce(started_at, '-infinity'::timestamptz)) desc, id desc);

create function public.search_quest_results(
  p_quest_id uuid, p_search text default '', p_completion text default 'all',
  p_after jsonb default null, p_limit integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null or not public.has_quest_permission(p_quest_id,'quest_stats.read') then
    raise exception using errcode='42501', message='quest statistics access denied';
  end if;
  if length(v_search)>200 or p_completion is null or p_completion not in ('all','finished','unfinished') then
    raise exception using errcode='22023', message='invalid results filter';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'quest_id' is distinct from p_quest_id::text
      or p_after->>'search' is distinct from v_search
      or p_after->>'completion' is distinct from p_completion
      or not (p_after ? 'started_at') or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023', message='invalid results cursor';
    end if;
    begin
      v_id := (p_after->>'id')::uuid;
      v_date := coalesce((p_after->>'started_at')::timestamptz,'-infinity'::timestamptz);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='invalid results cursor';
    end;
  end if;
  with page as (
    select a.id, a.started_at, a.finished_at, a.total_tasks, a.completed_tasks,
      a.failed_tasks, a.total_attempts, a.percent_success,
      a.trusted_time_seconds, a.reported_offline_time_seconds, a.timing_confidence,
      p.display_name participant_display_name, u.username executor_username
    from public.quest_attempts a
    left join public.participant_profiles p on p.id=a.participant_profile_id
    left join public.profiles u on u.id=a.user_id
    where a.quest_id=p_quest_id
      and (p_completion='all' or (p_completion='finished' and a.finished_at is not null)
        or (p_completion='unfinished' and a.finished_at is null))
      and (v_search='' or strpos(lower(coalesce(p.display_name,'')),lower(v_search))>0
        or strpos(lower(coalesce(u.username,'')),lower(v_search))>0)
      and (p_after is null or (coalesce(a.started_at,'-infinity'::timestamptz),a.id)<(v_date,v_id))
    order by coalesce(a.started_at,'-infinity'::timestamptz) desc,a.id desc limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by coalesce(started_at,'-infinity'::timestamptz) desc,id desc),'[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('quest_id',p_quest_id,'completion',p_completion,'items',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'quest_id',p_quest_id,
      'search',v_search,'completion',p_completion,'id',v_last->>'id','started_at',v_last->'started_at') else null end);
end;
$$;
revoke all on function public.search_quest_results(uuid,text,text,jsonb,integer) from public,anon;
grant execute on function public.search_quest_results(uuid,text,text,jsonb,integer) to authenticated;
