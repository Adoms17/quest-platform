-- Каталог выбранного участника. Контроль профиля и доступ проверяются заново.
create index if not exists quest_attempts_participant_active_catalog_idx
  on public.quest_attempts (participant_profile_id, quest_id) where finished_at is null;

create or replace function public.search_participant_quests(
  p_participant_profile_id uuid,
  p_search text default '',
  p_filter text default 'all',
  p_after jsonb default null,
  p_limit integer default 25
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_title text;
  v_id uuid;
  v_started timestamptz;
  v_rows jsonb;
  v_last jsonb;
  v_more boolean;
begin
  if auth.uid() is null or p_participant_profile_id is null or not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode='42501', message='participant catalog access denied';
  end if;
  if p_filter is null or p_filter not in ('all','started') or length(v_search)>200 then
    raise exception using errcode='22023', message='invalid participant search';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) <> 'object'
      or (p_after->>'profile_id') is distinct from p_participant_profile_id::text
      or (p_after->>'search') is distinct from v_search
      or (p_after->>'filter') is distinct from p_filter
      or jsonb_typeof(p_after->'title') is distinct from 'string'
      or nullif(p_after->>'id','') is null
      or (p_filter='started' and nullif(p_after->>'started_at','') is null) then
      raise exception using errcode='22023', message='invalid participant cursor';
    end if;
    v_title := p_after->>'title'; v_id := (p_after->>'id')::uuid;
    if p_filter='started' then v_started := (p_after->>'started_at')::timestamptz; end if;
  end if;
  v_pattern := '%' || replace(replace(replace(v_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  -- Те же условия, что can_actor_access_quest: контроль профиля выше,
  -- затем публичность либо активный неистёкший grant именно этого профиля.
  -- Каталог уже общего доступа: только выданные квесты и начатые публичные.
  with granted as materialized (
    select g.quest_id from public.quest_access_grants g
    where g.participant_profile_id=p_participant_profile_id and g.status='active'
      and (g.expires_at is null or g.expires_at>now())
  ), active as materialized (
    select a.quest_id, a.id, a.started_at, a.deadline_at, a.completed_tasks, a.total_tasks
    from public.quest_attempts a
    where a.participant_profile_id=p_participant_profile_id and a.finished_at is null
      and (a.deadline_at is null or a.deadline_at>now())
  ), candidates as (
    select quest_id from granted union select quest_id from active
  ), page as (
    select q.id, q.title, left(q.description,180) description, q.start_at, q.end_at,
      a.id active_attempt_id, a.started_at attempt_started_at, a.deadline_at,
      a.completed_tasks, a.total_tasks, lower(q.title) sort_title
    from candidates c join public.quests q on q.id=c.quest_id
    left join active a on a.quest_id=q.id
    where q.is_open=true and (q.start_at is null or q.start_at<=now()) and (q.end_at is null or q.end_at>=now())
      and (q.is_public=true or exists(select 1 from granted g where g.quest_id=q.id))
      and (p_filter='all' or a.id is not null)
      and (v_search='' or q.title ilike v_pattern escape E'\\')
      and (p_after is null
        or (p_filter='all' and (lower(q.title),q.id)>(v_title,v_id))
        or (p_filter='started' and (a.started_at<v_started or (a.started_at=v_started and (lower(q.title),q.id)>(v_title,v_id)))))
    order by case when p_filter='started' then a.started_at end desc nulls last, lower(q.title),q.id limit v_limit+1
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by case when p_filter='started' then attempt_started_at end desc nulls last, sort_title,id),'[]'::jsonb) into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows := v_rows-v_limit; end if;
  v_last := v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('items',v_rows,'has_more',v_more,'next_cursor',case when v_more then
    jsonb_build_object('profile_id',p_participant_profile_id,'search',v_search,'filter',p_filter,'title',v_last->'sort_title','id',v_last->'id','started_at',v_last->'attempt_started_at') else null end);
end;
$$;
revoke all on function public.search_participant_quests(uuid,text,text,jsonb,integer) from public,anon;
grant execute on function public.search_participant_quests(uuid,text,text,jsonb,integer) to authenticated;
