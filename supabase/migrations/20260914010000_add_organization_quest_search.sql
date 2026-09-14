-- Рабочий список: серверная проверка organization permission и ограниченная выдача.
-- RLS таблицы сохраняется; RPC соответствует Members can read organization quests.
create extension if not exists pg_trgm with schema extensions;

create index if not exists quests_organization_list_cursor_idx
  on public.quests (organization_id, (coalesce(is_open, false)) desc,
    (coalesce(created_at, '-infinity'::timestamptz)) desc, id desc);
create index if not exists quests_title_search_idx
  on public.quests using gin (title extensions.gin_trgm_ops);

create or replace function public.search_organization_quests(
  p_organization_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_after jsonb default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
-- Курсор и фильтры должны участвовать в выборе индекса, а не в generic plan.
set plan_cache_mode = force_custom_plan
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_open boolean;
  v_created_at timestamptz;
  v_id uuid;
  v_rows jsonb;
  v_last jsonb;
  v_more boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_organization_permission(p_organization_id, 'quests.read') then
    raise exception using errcode = '42501', message = 'organization quest access denied';
  end if;
  if p_status is null or p_status not in ('all', 'open', 'closed') or length(v_search) > 200 then
    raise exception using errcode = '22023', message = 'invalid quest search';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) <> 'object'
      or (p_after->>'organization_id') is distinct from p_organization_id::text
      or (p_after->>'search') is distinct from v_search
      or (p_after->>'status') is distinct from p_status
      or jsonb_typeof(p_after->'is_open') is distinct from 'boolean'
      or nullif(p_after->>'created_at', '') is null
      or nullif(p_after->>'id', '') is null then
      raise exception using errcode = '22023', message = 'invalid quest cursor';
    end if;
    v_open := (p_after->>'is_open')::boolean;
    v_created_at := (p_after->>'created_at')::timestamptz;
    v_id := (p_after->>'id')::uuid;
  end if;
  -- Пользовательские %, _ и обратная косая черта ищутся буквально.
  v_pattern := '%' || replace(replace(replace(v_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  -- B(org) = has_organization_permission(org, 'quests.read') проверено выше.
  -- Для каждой возвращаемой строки q.organization_id = org, следовательно B(q.org).
  -- B — самостоятельная PERMISSIVE SELECT policy quests. Возвращаем только явные поля.
  with page as (
    select q.id, q.title, left(q.description, 180) as description,
      coalesce(q.is_open, false) as is_open, coalesce(q.is_public, false) as is_public,
      coalesce(q.created_at, '-infinity'::timestamptz) as created_at,
      q.start_at, q.end_at
    from public.quests q
    where q.organization_id = p_organization_id
      and (v_search = '' or q.title ilike v_pattern escape E'\\')
      and (p_status = 'all' or coalesce(q.is_open, false) = (p_status = 'open'))
      and (p_after is null or
        (coalesce(q.is_open, false), coalesce(q.created_at, '-infinity'::timestamptz), q.id)
          < (v_open, v_created_at, v_id))
    order by coalesce(q.is_open, false) desc, coalesce(q.created_at, '-infinity'::timestamptz) desc, q.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by is_open desc, created_at desc, id desc), '[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows) > v_limit;
  if v_more then v_rows := v_rows - v_limit; end if;
  v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
  return jsonb_build_object('items', v_rows, 'has_more', v_more, 'next_cursor',
    case when v_more then jsonb_build_object(
      'organization_id', p_organization_id, 'search', v_search, 'status', p_status,
      'is_open', v_last->'is_open', 'created_at', v_last->'created_at', 'id', v_last->'id'
    ) else null end);
end;
$$;

revoke all on function public.search_organization_quests(uuid, text, text, jsonb, integer) from public, anon;
grant execute on function public.search_organization_quests(uuid, text, text, jsonb, integer) to authenticated;
