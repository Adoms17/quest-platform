-- Журнал запросов не выдаётся клиенту и переживает удаление результата.
create table public.quest_creation_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request jsonb not null,
  quest_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id)
);
alter table public.quest_creation_requests enable row level security;
revoke all on public.quest_creation_requests from public, anon, authenticated;

create function public.create_organization_quest(
  p_organization_id uuid, p_operation_id uuid, p_values jsonb,
  p_source_quest_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  prior public.quest_creation_requests%rowtype;
  draft public.quests%rowtype;
  copied_task public.tasks%rowtype;
  request jsonb;
begin
  if actor is null or not public.has_organization_permission(p_organization_id,'quests.create') then
    raise exception 'quest creation access denied' using errcode='42501';
  end if;
  if p_operation_id is null or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'invalid quest creation request' using errcode='22023';
  end if;
  if p_source_quest_id is not null and (
    not public.has_quest_permission(p_source_quest_id,'quests.update')
    or not public.has_organization_permission(p_organization_id,'quests.update')
  ) then
    raise exception 'quest copy access denied' using errcode='42501';
  end if;
  request := jsonb_build_object('organization_id',p_organization_id,'values',p_values,'source',p_source_quest_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':quest-create:' || p_operation_id::text,0));
  select * into prior from public.quest_creation_requests where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior.request<>request then raise exception 'quest creation request conflict' using errcode='22023'; end if;
    if not exists(select 1 from public.quests where id=prior.quest_id and organization_id=p_organization_id) then
      raise exception 'created quest no longer available' using errcode='P0001';
    end if;
    return prior.quest_id;
  end if;
  if p_source_quest_id is null then
    if exists(select 1 from jsonb_object_keys(p_values) k where k not in (
      'title','description','cover_image_url','is_public','location_options','verification_options',
      'verification_match_policy','verification_mode','offline_progress_policy','max_attempts',
      'max_quest_attempts','time_limit_minutes','allow_late_offline_answers','task_navigation_mode'
    )) then raise exception 'unsupported quest creation field' using errcode='22023'; end if;
    insert into public.quests(creator_id,organization_id,title,description,cover_image_url,is_public,is_open,
      location_options,verification_options,verification_match_policy,verification_mode,offline_progress_policy,
      max_attempts,max_quest_attempts,time_limit_minutes,allow_late_offline_answers,task_navigation_mode)
    values(actor,p_organization_id,p_values->>'title',p_values->>'description',p_values->>'cover_image_url',
      coalesce((p_values->>'is_public')::boolean,false),false,
      coalesce(p_values->'location_options','["gps"]'::jsonb),coalesce(p_values->'verification_options','["gps"]'::jsonb),
      coalesce(p_values->>'verification_match_policy','all'),coalesce(p_values->>'verification_mode','online'),
      coalesce(p_values->>'offline_progress_policy','allow_pending'),coalesce((p_values->>'max_attempts')::integer,0),
      coalesce((p_values->>'max_quest_attempts')::integer,0),coalesce((p_values->>'time_limit_minutes')::integer,0),
      coalesce((p_values->>'allow_late_offline_answers')::boolean,false),coalesce(p_values->>'task_navigation_mode','sequential'))
    returning * into draft;
  else
    if p_values<>'{}'::jsonb then raise exception 'unsupported quest copy override' using errcode='22023'; end if;
    select * into draft from public.quests where id=p_source_quest_id for share;
    if not found then raise exception 'quest copy access denied' using errcode='42501'; end if;
    draft.id := gen_random_uuid();
    draft.creator_id := actor;
    draft.organization_id := p_organization_id;
    draft.created_at := statement_timestamp();
    draft.title := draft.title || ' (копия)';
    draft.is_open := false;
    insert into public.quests select draft.*;
    -- Одна транзакция: при ошибке любого задания откатывается и сам квест.
    for copied_task in select * from public.tasks where quest_id=p_source_quest_id order by id for share loop
      copied_task.id := gen_random_uuid();
      copied_task.quest_id := draft.id;
      insert into public.tasks select copied_task.*;
    end loop;
  end if;
  insert into public.quest_creation_requests(actor_id,operation_id,organization_id,request,quest_id)
    values(actor,p_operation_id,p_organization_id,request,draft.id);
  return draft.id;
end;
$$;
revoke all on function public.create_organization_quest(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_organization_quest(uuid,uuid,jsonb,uuid) to authenticated;
