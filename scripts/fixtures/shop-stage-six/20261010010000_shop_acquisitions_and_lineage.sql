-- SHOP04: organization-owned acquisitions. No payment bypass or client entitlement writer.
begin;

-- Captured raster covers use the same 10 MiB byte ceiling as shop materials.
-- Ordinary external URLs retain the existing length limit.
alter table public.quests drop constraint quests_cover_image_url_length_check;
alter table public.quests add constraint quests_cover_image_url_length_check check (
  cover_image_url is null or char_length(cover_image_url) <= 2048
  or (char_length(cover_image_url) <= 13981040
    and cover_image_url ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$')
);
create table public.shop_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,100}$'),
  title text not null check (length(btrim(title)) > 0),
  withdrawn boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.shop_quest_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id),
  version_label text not null check (length(btrim(version_label)) > 0),
  source_quest_id uuid not null,
  quest_snapshot jsonb not null check (jsonb_typeof(quest_snapshot) = 'object'),
  task_snapshots jsonb not null check (jsonb_typeof(task_snapshots) = 'array'),
  created_at timestamptz not null default now(),
  unique(product_id, version_label)
);
create table public.shop_acquisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  version_id uuid not null references public.shop_quest_versions(id),
  fulfillment_reference text not null unique check (length(btrim(fulfillment_reference)) > 0),
  acquired_at timestamptz not null default now()
);
create table public.shop_initial_copies (
  acquisition_id uuid primary key references public.shop_acquisitions(id),
  quest_id uuid not null unique,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
-- Receipt deliberately survives deletion of a working copy: retry must not issue another.
alter table public.quests
  add column shop_acquisition_id uuid references public.shop_acquisitions(id),
  add column shop_version_id uuid references public.shop_quest_versions(id),
  add column shop_owner_organization_id uuid references public.organizations(id),
  add column shop_parent_quest_id uuid,
  add constraint quest_shop_lineage_complete check (
    (shop_acquisition_id is null and shop_version_id is null and shop_owner_organization_id is null and shop_parent_quest_id is null)
    or (shop_acquisition_id is not null and shop_version_id is not null and shop_owner_organization_id is not null
      and organization_id = shop_owner_organization_id)
  );
alter table public.tasks
  add column shop_acquisition_id uuid references public.shop_acquisitions(id),
  add column shop_source_task_id uuid;
create index shop_acquisitions_organization_idx on public.shop_acquisitions(organization_id, acquired_at, id);
create index quests_shop_acquisition_idx on public.quests(shop_acquisition_id) where shop_acquisition_id is not null;

alter table public.shop_products enable row level security;
alter table public.shop_quest_versions enable row level security;
alter table public.shop_acquisitions enable row level security;
alter table public.shop_initial_copies enable row level security;
revoke all on public.shop_products, public.shop_quest_versions, public.shop_acquisitions, public.shop_initial_copies from public, anon, authenticated;
revoke all on public.shop_products, public.shop_quest_versions, public.shop_acquisitions, public.shop_initial_copies from service_role;
-- Source snapshots contain authoring content; clients only use the projected library RPC.
grant select, insert, update on public.shop_products to service_role;
grant select, insert on public.shop_acquisitions to service_role;
revoke all on public.shop_quest_versions, public.shop_initial_copies from service_role;

create function public.guard_shop_immutable_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'shop record is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.guard_shop_immutable_row() from public, anon, authenticated;
create trigger shop_version_immutable before update or delete on public.shop_quest_versions
  for each row execute function public.guard_shop_immutable_row();
create trigger shop_acquisition_immutable before update or delete on public.shop_acquisitions
  for each row execute function public.guard_shop_immutable_row();
create trigger shop_initial_copy_immutable before update or delete on public.shop_initial_copies
  for each row execute function public.guard_shop_immutable_row();

-- SECURITY INVOKER is intentional: only the owner-executed issuance/copy commands
-- may stamp lineage. No caller-set GUC or supplied metadata authorizes stamping.
create function public.guard_quest_shop_lineage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.shop_acquisition_id is not null and current_user <> 'postgres' then
      raise exception 'shop lineage requires server issuance' using errcode = '42501';
    end if;
  else
    if row(new.shop_acquisition_id, new.shop_version_id, new.shop_owner_organization_id, new.shop_parent_quest_id)
      is distinct from row(old.shop_acquisition_id, old.shop_version_id, old.shop_owner_organization_id, old.shop_parent_quest_id) then
      raise exception 'shop lineage is immutable' using errcode = '23514';
    end if;
    if old.shop_acquisition_id is not null and
      row(new.id, new.organization_id, new.creator_id) is distinct from row(old.id, old.organization_id, old.creator_id) then
      raise exception 'purchased quest cannot change ownership' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_quest_shop_lineage() from public, anon, authenticated;
create trigger guard_quest_shop_lineage before insert or update on public.quests
  for each row execute function public.guard_quest_shop_lineage();

create function public.guard_task_shop_lineage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_acquisition uuid;
begin
  select q.shop_acquisition_id into parent_acquisition from public.quests q where q.id = new.quest_id for share;
  if tg_op = 'UPDATE' then
    if row(new.shop_acquisition_id, new.shop_source_task_id) is distinct from row(old.shop_acquisition_id, old.shop_source_task_id) then
      raise exception 'task shop lineage is immutable' using errcode = '23514';
    end if;
    if old.shop_acquisition_id is not null and (new.id <> old.id or parent_acquisition is distinct from old.shop_acquisition_id) then
      raise exception 'task cannot leave its acquisition' using errcode = '23514';
    end if;
    if old.shop_acquisition_id is null and parent_acquisition is not null then
      raise exception 'task import requires a supported provenance contract' using errcode = '23514';
    end if;
  else
    if new.shop_acquisition_id is not null and new.shop_acquisition_id is distinct from parent_acquisition then
      raise exception 'task acquisition mismatch' using errcode = '23514';
    end if;
    if parent_acquisition is null and new.shop_source_task_id is not null then
      raise exception 'task source requires acquisition' using errcode = '23514';
    end if;
    new.shop_acquisition_id := parent_acquisition;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_task_shop_lineage() from public, anon, authenticated;
create trigger guard_task_shop_lineage before insert or update on public.tasks
  for each row execute function public.guard_task_shop_lineage();

create function public.guard_task_shop_source_input() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'postgres' and (new.shop_source_task_id is not null or new.shop_acquisition_id is not null) then
    raise exception 'task provenance requires server issuance' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_task_shop_source_input() from public, anon, authenticated;
create trigger aa_guard_task_shop_source_input before insert on public.tasks
  for each row execute function public.guard_task_shop_source_input();

-- Inline resource format v1: the trusted publisher captures bytes, not expiring URLs.
-- The database verifies each supplied digest and embeds immutable bytes in snapshots.
-- Large/streamed packages need a separately versioned Storage contract; never silently
-- fall back to the editable source URL. No client can invoke this helper.
create function public.capture_shop_material(p_url text, p_materials jsonb)
returns text language plpgsql set search_path = '' as $$
declare resource jsonb; bytes bytea; mime text;
begin
  if p_url is null or p_url = '' then return p_url; end if;
  resource := p_materials -> p_url;
  if resource is null or jsonb_typeof(resource) <> 'object' then
    raise exception 'material bytes missing from publication' using errcode = '22023';
  end if;
  mime := resource->>'content_type';
  if mime is null or mime not in ('image/png','image/jpeg','image/webp','image/gif','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm') then
    raise exception 'unsupported shop material type' using errcode = '22023';
  end if;
  bytes := decode(resource->>'base64', 'base64');
  if bytes is null or octet_length(bytes) = 0 or octet_length(bytes) > 10485760
    or resource->>'sha256' is distinct from encode(extensions.digest(bytes, 'sha256'), 'hex') then
    raise exception 'invalid shop material bytes or checksum' using errcode = '22023';
  end if;
  return 'data:' || mime || ';base64,' || replace(encode(bytes, 'base64'), E'\n', '');
end;
$$;
revoke all on function public.capture_shop_material(text, jsonb) from public, anon, authenticated, service_role;

-- Trusted publication boundary, separate from payment fulfillment. Every material
-- reference is replaced by captured bytes, never by the public demo DTO.
create function public.publish_shop_quest_version(p_product_id uuid, p_source_quest_id uuid, p_version_label text, p_materials jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare source public.quests%rowtype; tasks jsonb := '[]'::jsonb; result uuid;
  source_task public.tasks%rowtype; media jsonb; entry jsonb; captured_media jsonb;
begin
  if p_materials is null or jsonb_typeof(p_materials) <> 'object' or octet_length(p_materials::text) > 41943040 then
    raise exception 'invalid shop material package (maximum 40 MiB encoded)' using errcode = '22023';
  end if;
  select * into source from public.quests where id = p_source_quest_id for update;
  if not found or source.shop_acquisition_id is not null then
    raise exception 'shop source unavailable' using errcode = '22023';
  end if;
  source.cover_image_url := public.capture_shop_material(source.cover_image_url, p_materials);
  if source.cover_image_url is not null and source.cover_image_url <> ''
    and source.cover_image_url !~ '^data:image/(png|jpeg|webp|gif);base64,' then
    raise exception 'cover must be a supported raster image' using errcode = '22023';
  end if;
  for source_task in select * from public.tasks where quest_id = source.id order by order_index, id for share loop
    source_task.image_url := public.capture_shop_material(source_task.image_url, p_materials);
    source_task.location_image_url := public.capture_shop_material(source_task.location_image_url, p_materials);
    media := coalesce(source_task.media, '[]'::jsonb);
    if jsonb_typeof(media) <> 'array' then raise exception 'invalid task media' using errcode = '22023'; end if;
    captured_media := '[]'::jsonb;
    for entry in select value from jsonb_array_elements(media) loop
      if jsonb_typeof(entry) <> 'object' or nullif(entry->>'url', '') is null then
        raise exception 'invalid task media entry' using errcode = '22023';
      end if;
      captured_media := captured_media || jsonb_build_array(entry || jsonb_build_object(
        'url', public.capture_shop_material(entry->>'url', p_materials)));
    end loop;
    source_task.media := captured_media;
    tasks := tasks || jsonb_build_array(to_jsonb(source_task));
    if octet_length(tasks::text) + octet_length(to_jsonb(source)::text) > 41943040 then
      raise exception 'captured shop version exceeds 40 MiB encoded' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(tasks) = 0 then raise exception 'shop source has no tasks' using errcode = '22023'; end if;
  insert into public.shop_quest_versions(product_id, version_label, source_quest_id, quest_snapshot, task_snapshots)
    values(p_product_id, p_version_label, source.id, to_jsonb(source), tasks) returning id into result;
  return result;
end;
$$;
revoke all on function public.publish_shop_quest_version(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_shop_quest_version(uuid, uuid, text, jsonb) to service_role;

create function public.list_organization_shop_purchases(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id, 'quests.read') then
    raise exception 'shop library access denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'acquisition_id', a.id, 'organization_id', a.organization_id,
    'product_id', p.id, 'title', p.title, 'withdrawn', p.withdrawn,
    'version_id', v.id, 'version_label', v.version_label, 'acquired_at', a.acquired_at,
    'quest_id', c.quest_id, 'copy_available', q.id is not null
  ) order by a.acquired_at desc, a.id), '[]'::jsonb) into result
  from public.shop_acquisitions a join public.shop_quest_versions v on v.id = a.version_id
    join public.shop_products p on p.id = v.product_id
    left join public.shop_initial_copies c on c.acquisition_id = a.id
    left join public.quests q on q.id = c.quest_id and q.organization_id = a.organization_id
  where a.organization_id = p_organization_id;
  return result;
end;
$$;
revoke all on function public.list_organization_shop_purchases(uuid) from public, anon, authenticated;
grant execute on function public.list_organization_shop_purchases(uuid) to authenticated;

create function public.issue_shop_quest_copy(p_organization_id uuid, p_acquisition_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare acquisition public.shop_acquisitions%rowtype; version public.shop_quest_versions%rowtype;
  draft public.quests%rowtype; task public.tasks%rowtype; item jsonb; prior uuid;
begin
  if auth.uid() is null or not public.has_organization_permission(p_organization_id, 'quests.create')
    or not public.has_organization_permission(p_organization_id, 'quests.update') then
    raise exception 'shop issuance access denied' using errcode = '42501';
  end if;
  select * into acquisition from public.shop_acquisitions
    where id = p_acquisition_id and organization_id = p_organization_id for update;
  if not found then raise exception 'shop acquisition unavailable' using errcode = '42501'; end if;
  select quest_id into prior from public.shop_initial_copies where acquisition_id = acquisition.id;
  if found then
    if not exists(select 1 from public.quests where id = prior and organization_id = p_organization_id) then
      raise exception 'shop original copy was deleted' using errcode = 'P0001';
    end if;
    return prior;
  end if;
  select * into strict version from public.shop_quest_versions where id = acquisition.version_id;
  draft := jsonb_populate_record(null::public.quests, version.quest_snapshot);
  draft.id := gen_random_uuid(); draft.creator_id := auth.uid(); draft.organization_id := p_organization_id;
  draft.created_at := statement_timestamp(); draft.is_open := false; draft.is_public := false;
  draft.start_at := null; draft.end_at := null;
  draft.shop_acquisition_id := acquisition.id; draft.shop_version_id := version.id;
  draft.shop_owner_organization_id := p_organization_id; draft.shop_parent_quest_id := null;
  insert into public.quests select draft.*;
  for item in select value from jsonb_array_elements(version.task_snapshots) loop
    task := jsonb_populate_record(null::public.tasks, item);
    task.shop_source_task_id := task.id; task.id := gen_random_uuid(); task.quest_id := draft.id;
    task.shop_acquisition_id := acquisition.id;
    insert into public.tasks select task.*;
  end loop;
  insert into public.shop_initial_copies(acquisition_id, quest_id, actor_id) values(acquisition.id, draft.id, auth.uid());
  return draft.id;
end;
$$;
revoke all on function public.issue_shop_quest_copy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_shop_quest_copy(uuid, uuid) to authenticated;

-- Extend the existing copy command; preserve its normal-content semantics.
create or replace function public.create_organization_quest(
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
    if draft.shop_acquisition_id is not null then
      if draft.shop_owner_organization_id <> p_organization_id then
        raise exception 'purchased quest cannot cross organizations' using errcode='23514';
      end if;
      draft.shop_parent_quest_id := p_source_quest_id;
    end if;
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
commit;
