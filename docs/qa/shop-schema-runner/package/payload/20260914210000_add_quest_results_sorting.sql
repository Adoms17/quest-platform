-- Отдельная RPC сохраняет контракт старых клиентов search_quest_results.
create function public.search_quest_results_sorted(
  p_quest_id uuid, p_search text default '', p_completion text default 'all',
  p_after jsonb default null, p_limit integer default 25, p_sort text default 'newest'
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_missing integer; v_number numeric; v_text text; v_id uuid;
  v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null or not public.has_quest_permission(p_quest_id,'quest_stats.read') then
    raise exception using errcode='42501', message='quest statistics access denied';
  end if;
  if length(v_search)>200 or p_completion is null or p_completion not in ('all','finished','unfinished')
    or p_sort is null or p_sort not in ('newest','oldest','success','time','name') then
    raise exception using errcode='22023', message='invalid results filter';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'quest_id' is distinct from p_quest_id::text
      or p_after->>'search' is distinct from v_search
      or p_after->>'completion' is distinct from p_completion
      or p_after->>'sort' is distinct from p_sort
      or jsonb_typeof(p_after->'missing') is distinct from 'number'
      or jsonb_typeof(p_after->'number') is distinct from 'number'
      or jsonb_typeof(p_after->'text') is distinct from 'string'
      or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023', message='invalid results cursor';
    end if;
    begin
      v_missing := (p_after->>'missing')::integer;
      v_number := (p_after->>'number')::numeric;
      v_text := p_after->>'text';
      v_id := (p_after->>'id')::uuid;
      if v_missing not in (0,1) then raise invalid_text_representation; end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023', message='invalid results cursor';
    end;
  end if;
  with source as (
    select a.id, a.started_at, a.finished_at, a.total_tasks, a.completed_tasks,
      a.failed_tasks, a.total_attempts, a.percent_success,
      a.trusted_time_seconds, a.reported_offline_time_seconds, a.timing_confidence,
      p.display_name participant_display_name, u.username executor_username,
      case p_sort
        when 'newest' then -extract(epoch from a.started_at)
        when 'oldest' then extract(epoch from a.started_at)
        when 'success' then -a.percent_success
        when 'time' then case when a.finished_at is not null and a.timing_confidence='trusted' then a.trusted_time_seconds end
        else 0 end sort_number,
      case when p_sort='name' then lower(coalesce(nullif(p.display_name,''),nullif(u.username,''))) else '' end sort_text
    from public.quest_attempts a
    left join public.participant_profiles p on p.id=a.participant_profile_id
    left join public.profiles u on u.id=a.user_id
    where a.quest_id=p_quest_id
      and (p_completion='all' or (p_completion='finished' and a.finished_at is not null)
        or (p_completion='unfinished' and a.finished_at is null))
      and (v_search='' or strpos(lower(coalesce(p.display_name,'')),lower(v_search))>0
        or strpos(lower(coalesce(u.username,'')),lower(v_search))>0)
  ), keyed as (
    select source.*, case when sort_number is null or sort_text is null then 1 else 0 end sort_missing,
      coalesce(sort_number,0) key_number, coalesce(sort_text,'') key_text from source
  ), page as (
    select * from keyed
    where p_after is null or (sort_missing,key_number,key_text collate "C",id) > (v_missing,v_number,v_text collate "C",v_id)
    order by sort_missing,key_number,key_text collate "C",id limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by sort_missing,key_number,key_text collate "C",id),'[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  select coalesce(jsonb_agg(value - array['sort_number','sort_text','sort_missing','key_number','key_text'] order by ordinal),'[]'::jsonb)
    into v_rows from jsonb_array_elements(v_rows) with ordinality as item(value,ordinal);
  return jsonb_build_object('quest_id',p_quest_id,'completion',p_completion,'sort',p_sort,'items',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('actor_id',auth.uid(),'quest_id',p_quest_id,
      'search',v_search,'completion',p_completion,'sort',p_sort,'id',v_last->>'id',
      'missing',v_last->'sort_missing','number',v_last->'key_number','text',v_last->'key_text') else null end);
end;
$$;
revoke all on function public.search_quest_results_sorted(uuid,text,text,jsonb,integer,text) from public,anon;
grant execute on function public.search_quest_results_sorted(uuid,text,text,jsonb,integer,text) to authenticated;
