-- PROFILE-01. Existing actor/profile visibility and rename rights are unchanged.
alter table public.participant_profiles
  add column nickname text,
  add column avatar_path text,
  add column identity_revision integer not null default 0,
  add constraint participant_nickname_valid check (nickname is null or
    (char_length(nickname) between 2 and 40 and nickname !~ '[[:space:][:cntrl:]<>/&]'));

create function public.can_edit_participant_identity(p_profile uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and exists(
  select 1 from public.participant_profiles p where p.id=p_profile and p.status='active' and (
   exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id
    and a.user_id=auth.uid() and a.relationship='self' and a.status='active')
   or (p.created_by_user_id=auth.uid() and not exists(select 1 from public.participant_profile_accounts a
    where a.participant_profile_id=p.id and a.relationship='self' and a.status='active'))));
$$;
revoke all on function public.can_edit_participant_identity(uuid) from public,anon;
grant execute on function public.can_edit_participant_identity(uuid) to authenticated;

-- Permanent anti-reuse set: UUID only, no actor/profile/path/timestamps or FKs.
-- Reserved atomically with the live upload in begin; never garbage-collect IDs.
create table platform_private.participant_avatar_ids (id uuid primary key);
alter table platform_private.participant_avatar_ids enable row level security;
revoke all on platform_private.participant_avatar_ids from public,anon,authenticated,service_role;

create table platform_private.participant_avatar_uploads (
 id uuid primary key,
 profile_id uuid not null references public.participant_profiles(id),
 actor_id uuid not null references public.profiles(id),
 object_path text not null unique,
 state text not null check(state in ('pending','ready','attached','deleting')),
 expires_at timestamptz not null default now()+interval '15 minutes',
 created_at timestamptz not null default now()
);
alter table platform_private.participant_avatar_uploads enable row level security;
revoke all on platform_private.participant_avatar_uploads from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('participant-avatars','participant-avatars',false,1048576,array['image/png']);

-- No authenticated upload/update/delete policy: only the PNG-verifying Edge handler writes.
create policy "Read current accessible participant avatar" on storage.objects
 for select to authenticated using(bucket_id='participant-avatars' and exists(
  select 1 from public.participant_profiles p where p.avatar_path=name
   and p.status='active' and public.can_access_participant_profile(p.id)));

-- Restrictive fences also hold if an environment has an older broad permissive
-- Storage policy. They leave every other bucket unchanged; service_role bypasses RLS.
create policy "Fence participant avatar reads" on storage.objects as restrictive
 for select to authenticated using(bucket_id<>'participant-avatars' or exists(
  select 1 from public.participant_profiles p where p.avatar_path=name
   and p.status='active' and public.can_access_participant_profile(p.id)));
create policy "Fence anonymous participant avatars" on storage.objects as restrictive
 for all to anon using(bucket_id<>'participant-avatars') with check(bucket_id<>'participant-avatars');
create policy "Fence participant avatar inserts" on storage.objects as restrictive
 for insert to authenticated with check(bucket_id<>'participant-avatars');
create policy "Fence participant avatar updates" on storage.objects as restrictive
 for update to authenticated using(bucket_id<>'participant-avatars') with check(bucket_id<>'participant-avatars');
create policy "Fence participant avatar deletes" on storage.objects as restrictive
 for delete to authenticated using(bucket_id<>'participant-avatars');

create function public.begin_participant_avatar(p_profile uuid,p_upload uuid,p_revision integer)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_revision integer; v_path text;
begin
 if not public.can_edit_participant_identity(p_profile) then
  raise exception using errcode='42501',message='participant identity edit denied';
 end if;
 select identity_revision into v_revision from public.participant_profiles where id=p_profile for update;
 if not public.can_edit_participant_identity(p_profile) then raise exception using errcode='42501',message='participant identity edit denied'; end if;
 if v_revision is distinct from p_revision then
  raise exception using errcode='40001',message='participant identity changed';
 end if;
 if p_upload is null or (select count(*) from platform_private.participant_avatar_uploads
  where profile_id=p_profile and state in ('pending','ready') and expires_at>now())>=3 then
  raise exception using errcode='22023',message='avatar upload unavailable';
 end if;
 v_path:=p_profile::text||'/'||p_upload::text||'.png';
 -- One transaction: failed live reservation also rolls back the anti-reuse ID.
 -- The permanent PK serializes concurrent reuse, including across profiles.
 insert into platform_private.participant_avatar_ids(id) values(p_upload);
 insert into platform_private.participant_avatar_uploads(id,profile_id,actor_id,object_path,state)
  values(p_upload,p_profile,auth.uid(),v_path,'pending');
 return v_path;
end;
$$;

-- Called only after the trusted handler verified and stored the PNG bytes.
create function public.confirm_participant_avatar_upload(p_upload uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update platform_private.participant_avatar_uploads u set state='ready'
 where u.id=p_upload and u.actor_id=p_actor and u.state='pending' and u.expires_at>now()
  and exists(select 1 from storage.objects o where o.bucket_id='participant-avatars' and o.name=u.object_path);
 if not found then raise exception using errcode='22023',message='avatar upload expired'; end if;
end;
$$;
revoke all on function public.confirm_participant_avatar_upload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_participant_avatar_upload(uuid,uuid) to service_role;

create function public.save_participant_identity(p_profile uuid,p_revision integer,p_nickname text,
 p_upload uuid default null,p_remove_avatar boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_profile public.participant_profiles; v_path text; v_nick text:=nullif(btrim(p_nickname),'');
begin
 if not public.can_edit_participant_identity(p_profile) then
  raise exception using errcode='42501',message='participant identity edit denied';
 end if;
 if v_nick is not null and (char_length(v_nick) not between 2 and 40 or v_nick ~ '[[:space:][:cntrl:]<>/&]')
  or (p_upload is not null and p_remove_avatar) or p_remove_avatar is null then
  raise exception using errcode='22023',message='invalid participant identity';
 end if;
 select * into v_profile from public.participant_profiles where id=p_profile for update;
 if not public.can_edit_participant_identity(p_profile) then raise exception using errcode='42501',message='participant identity edit denied'; end if;
 if v_profile.identity_revision is distinct from p_revision then
  raise exception using errcode='40001',message='participant identity changed';
 end if;
 v_path:=case when p_remove_avatar then null else v_profile.avatar_path end;
 if p_upload is not null then
  update platform_private.participant_avatar_uploads set state='attached'
  where id=p_upload and profile_id=p_profile and actor_id=auth.uid() and state='ready' and expires_at>now()
  returning object_path into v_path;
  if not found then raise exception using errcode='42501',message='avatar upload unavailable'; end if;
 end if;
 update public.participant_profiles set nickname=v_nick,avatar_path=v_path,
  identity_revision=identity_revision+1,updated_at=now() where id=p_profile;
 return jsonb_build_object('id',p_profile,'nickname',v_nick,'avatar_path',v_path,'identity_revision',p_revision+1);
end;
$$;

-- Bounded, per-profile cleanup. Claim before deleting prevents late attachment.
-- Repeated claims include deleting entries, so interrupted Storage deletes are retryable.
create function public.claim_participant_avatar_cleanup(p_profile uuid,p_discard uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_current text; v_result jsonb;
begin
 if not public.can_edit_participant_identity(p_profile) then
  raise exception using errcode='42501',message='participant identity edit denied';
 end if;
 select avatar_path into v_current from public.participant_profiles where id=p_profile for update;
 if not public.can_edit_participant_identity(p_profile) then raise exception using errcode='42501',message='participant identity edit denied'; end if;
 with candidates as (
  select id from platform_private.participant_avatar_uploads where profile_id=p_profile
   and object_path is distinct from v_current
   and (state in ('attached','deleting') or expires_at<now()
    or (id=p_discard and actor_id=auth.uid() and state='ready'))
   order by created_at limit 20 for update
 ), claimed as (
  update platform_private.participant_avatar_uploads set state='deleting' where id in(select id from candidates)
  returning id,object_path
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path)),'[]') into v_result from claimed;
 return v_result;
end;
$$;

create function public.finish_participant_avatar_cleanup(p_uploads uuid[])
returns void language sql security definer set search_path=pg_catalog,public as $$
 -- Remove linked metadata after Storage deletion. The UUID-only anti-reuse set
 -- was reserved at begin, so no delete/re-reserve race window is introduced.
 delete from platform_private.participant_avatar_uploads
 where id=any(p_uploads) and state='deleting';
$$;
revoke all on function public.finish_participant_avatar_cleanup(uuid[]) from public,anon,authenticated;
grant execute on function public.finish_participant_avatar_cleanup(uuid[]) to service_role;

-- A failed trusted upload must be reclaimable even if its actor lost edit access.
-- Browser cleanup cannot discard pending requests while bytes are still being stored.
create function public.claim_failed_participant_avatar(p_profile uuid,p_upload uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_current text; v_result jsonb;
begin
 select avatar_path into v_current from public.participant_profiles where id=p_profile for update;
 with claimed as (
  update platform_private.participant_avatar_uploads set state='deleting'
  where id=p_upload and profile_id=p_profile and object_path is distinct from v_current
  returning id,object_path
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path)),'[]') into v_result from claimed;
 return v_result;
end;
$$;
revoke all on function public.claim_failed_participant_avatar(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_failed_participant_avatar(uuid,uuid) to service_role;

-- Maintenance hook for abandoned uploads and obsolete objects, including revoked actors.
-- No schedule is installed. A future trusted worker must delete via Storage API and
-- acknowledge only successful deletes with finish_participant_avatar_cleanup.
create function public.claim_expired_participant_avatars()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_profile record; v_item record; v_result jsonb:='[]';
begin
 for v_profile in select p.id,p.avatar_path from public.participant_profiles p
  where exists(select 1 from platform_private.participant_avatar_uploads u where u.profile_id=p.id
   and u.object_path is distinct from p.avatar_path and (u.state in ('attached','deleting') or u.expires_at<now()))
  order by p.id limit 20 for update of p skip locked
 loop
  for v_item in update platform_private.participant_avatar_uploads set state='deleting'
   where id in(select id from platform_private.participant_avatar_uploads
    where profile_id=v_profile.id and object_path is distinct from v_profile.avatar_path
    and (state in ('attached','deleting') or expires_at<now())
    order by created_at limit (20-jsonb_array_length(v_result)) for update skip locked)
   returning id,object_path
  loop v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_item.id,'path',v_item.object_path)); end loop;
  exit when jsonb_array_length(v_result)>=20;
 end loop;
 return v_result;
end;
$$;
revoke all on function public.claim_expired_participant_avatars() from public,anon,authenticated;
grant execute on function public.claim_expired_participant_avatars() to service_role;
revoke all on function public.begin_participant_avatar(uuid,uuid,integer),
 public.save_participant_identity(uuid,integer,text,uuid,boolean),
 public.claim_participant_avatar_cleanup(uuid,uuid) from public,anon;
grant execute on function public.begin_participant_avatar(uuid,uuid,integer),
 public.save_participant_identity(uuid,integer,text,uuid,boolean),
 public.claim_participant_avatar_cleanup(uuid,uuid) to authenticated;

-- Карточка одного профиля; разрешения соответствуют существующим RPC.
create or replace function public.get_participant_profile_card(p_participant_profile_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
set jit = off
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='participant profile access denied';
  end if;
  select jsonb_build_object(
    'id',p.id,'display_name',p.display_name,'profile_kind',p.profile_kind,'age_group',p.age_group,
    'nickname',case when public.can_access_participant_profile(p.id) then p.nickname else null end,
    'avatar_path',case when public.can_access_participant_profile(p.id) then p.avatar_path else null end,
    'identity_revision',p.identity_revision,
    'is_self',exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id and a.user_id=auth.uid() and a.relationship='self' and a.status='active'),
    'supervision_status',s.status,
    'can_participate',public.can_access_participant_profile(p.id),
    'can_rename',exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id and a.user_id=auth.uid() and a.relationship='self' and a.status='active')
      or (p.created_by_user_id=auth.uid() and not exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=p.id and a.relationship='self' and a.status='active'))
  ) into v_result
  from public.participant_profiles p
  left join public.participant_supervisions s on s.participant_profile_id=p.id and s.supervisor_user_id=auth.uid()
  where p.id=p_participant_profile_id and p.status='active'
    and (public.can_access_participant_profile(p.id) or s.status='suspended');
  if v_result is null then
    raise exception using errcode='42501', message='participant profile access denied';
  end if;
  return v_result;
end;
$$;
revoke all on function public.get_participant_profile_card(uuid) from public, anon;
grant execute on function public.get_participant_profile_card(uuid) to authenticated;

-- Состав одной доступной группы. Каждый профиль проверяется независимо.
-- Эквивалентно третьей ветви can_access_participant_profile: строка уже
-- имеет active membership в p_group_id, can_manage этой группы проверен выше.
-- Контакты и общее число скрытых участников не возвращаются.
create or replace function public.search_participant_group_members(
  p_group_id uuid, p_search text default '', p_after jsonb default null, p_limit integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan
set jit = off
as $$
declare
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_name text; v_id uuid; v_priority integer; v_group jsonb; v_manage boolean;
  v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='people catalog access denied';
  end if;
  select jsonb_build_object('id',g.id,'name',g.name,
    'can_manage',public.can_manage_participant_group(g.id),
    'can_leave',g.created_by_user_id<>auth.uid() and exists(select 1 from public.participant_group_members m where m.group_id=g.id and m.status='active' and m.participant_profile_id=public.current_self_participant_profile_id())) into v_group
  from public.participant_groups g where g.id=p_group_id and g.status='active'
    and public.can_access_participant_group(g.id);
  if v_group is null then
    raise exception using errcode='42501', message='people catalog access denied';
  end if;
  v_manage := (v_group->>'can_manage')::boolean;
  if length(v_search)>200 then
    raise exception using errcode='22023', message='invalid people search';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or (p_after->>'actor_id') is distinct from auth.uid()::text
      or (p_after->>'kind') is distinct from 'members'
      or (p_after->>'group_id') is distinct from p_group_id::text
      or (p_after->>'search') is distinct from v_search
      or jsonb_typeof(p_after->'name') is distinct from 'string'
      or coalesce(p_after->>'priority','') not in ('0','1','2')
      or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023', message='invalid people cursor';
    end if;
    begin
      v_name := p_after->>'name'; v_priority := (p_after->>'priority')::integer;
      v_id := (p_after->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023', message='invalid people cursor';
    end;
  end if;
  -- Те же три ветви can_access_participant_profile. Права связанных групп
  -- вычисляются один раз, а не для каждого участника выдачи.
  with relevant_groups as materialized (
    select distinct related.group_id
    from public.participant_group_members target
    join public.participant_group_members related
      on related.participant_profile_id=target.participant_profile_id and related.status='active'
    where target.group_id=p_group_id and target.status='active'
  ), managed_groups as materialized (
    select group_id from relevant_groups where public.can_manage_participant_group(group_id)
  ), accessible as materialized (
    select participant_profile_id from public.participant_profile_accounts
      where user_id=auth.uid() and status='active'
    union select participant_profile_id from public.participant_supervisions
      where supervisor_user_id=auth.uid() and status='active'
    union select participant_profile_id from public.participant_group_members
      where status='active' and group_id in (select group_id from managed_groups)
  ), permitted as (
    select p.id,p.display_name,p.nickname,p.avatar_path,p.profile_kind,m.member_role,
      exists(select 1 from public.participant_profile_accounts a
        where a.participant_profile_id=p.id and a.user_id=auth.uid()
          and a.relationship='self' and a.status='active') is_current_user,
      case when exists(select 1 from public.participant_profile_accounts a
        where a.participant_profile_id=p.id and a.user_id=auth.uid()
          and a.relationship='self' and a.status='active') then 0
        when m.member_role='leader' then 1 else 2 end sort_priority,
      lower(p.display_name) sort_name
    from public.participant_group_members m
    join public.participant_profiles p on p.id=m.participant_profile_id
    where m.group_id=p_group_id and m.status='active' and p.status='active'
      and (v_manage or p.id in (select participant_profile_id from accessible))
      and (v_search='' or strpos(lower(p.display_name),lower(v_search))>0)
  ), page as materialized (
    select * from permitted
    where p_after is null or (sort_priority,sort_name,id)>(v_priority,v_name,v_id)
    order by sort_priority,sort_name,id limit v_limit+1
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by sort_priority,sort_name,id),'[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows := v_rows - v_limit; end if;
  v_last := v_rows -> (jsonb_array_length(v_rows)-1);
  return jsonb_build_object('group',v_group,'items',v_rows,'has_more',v_more,'next_cursor',
    case when v_more then jsonb_build_object('actor_id',auth.uid(),'kind','members','group_id',p_group_id,
      'search',v_search,'priority',v_last->'sort_priority','name',v_last->>'sort_name','id',v_last->>'id') else null end);
end;
$$;
revoke all on function public.search_participant_group_members(uuid,text,jsonb,integer) from public, anon;
grant execute on function public.search_participant_group_members(uuid,text,jsonb,integer) to authenticated;
