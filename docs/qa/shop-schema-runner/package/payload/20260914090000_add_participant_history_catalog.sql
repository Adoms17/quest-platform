-- Порядок совместим с историей: started_at DESC NULLS FIRST, id DESC.
create index if not exists participant_history_catalog_idx
on public.quest_attempts(participant_profile_id, (coalesce(started_at, 'infinity'::timestamptz)) desc, id desc);

create function public.search_participant_quest_history(
  p_participant_profile_id uuid, p_after jsonb default null, p_limit integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null or not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode='42501', message='participant history access denied';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'profile_id' is distinct from p_participant_profile_id::text
      or not (p_after ? 'started_at') or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023',message='invalid history cursor';
    end if;
    begin
      v_id := (p_after->>'id')::uuid;
      v_date := coalesce((p_after->>'started_at')::timestamptz,'infinity'::timestamptz);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='invalid history cursor';
    end;
  end if;
  with page as (
    select a.id quest_attempt_id, q.id quest_id, q.title quest_title,
      a.started_at, a.finished_at, a.total_tasks, a.completed_tasks, a.failed_tasks,
      a.total_attempts, a.total_time, a.percent_success
    from public.quest_attempts a join public.quests q on q.id=a.quest_id
    where a.participant_profile_id=p_participant_profile_id
      and (p_after is null or (coalesce(a.started_at,'infinity'::timestamptz),a.id)<(v_date,v_id))
    order by coalesce(a.started_at,'infinity'::timestamptz) desc,a.id desc limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by coalesce(started_at,'infinity'::timestamptz) desc,quest_attempt_id desc),'[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('items',v_rows,'has_more',v_more,'next_cursor',case when v_more then
    jsonb_build_object('actor_id',auth.uid(),'profile_id',p_participant_profile_id,'id',v_last->>'quest_attempt_id','started_at',v_last->'started_at') else null end);
end;
$$;
revoke all on function public.search_participant_quest_history(uuid,jsonb,integer) from public,anon;
grant execute on function public.search_participant_quest_history(uuid,jsonb,integer) to authenticated;
