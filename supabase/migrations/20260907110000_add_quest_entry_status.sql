-- Availability is evaluated before participant access without exposing quest content.

create or replace function public.get_quest_entry_status(p_quest_id uuid)
returns table (
  id uuid,
  title text,
  is_open boolean,
  start_at timestamp with time zone,
  end_at timestamp with time zone
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  return query
  select quest.id, quest.title, quest.is_open, quest.start_at, quest.end_at
  from public.quests quest
  where quest.id = p_quest_id;
end;
$$;

revoke all on function public.get_quest_entry_status(uuid) from public, anon;
grant execute on function public.get_quest_entry_status(uuid) to authenticated;
