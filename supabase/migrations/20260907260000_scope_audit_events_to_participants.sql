-- Distinguish the authenticated actor from the participant affected by an audit event.

alter table public.organization_audit_events
  add column participant_profile_id uuid
  references public.participant_profiles(id) on delete set null;

create index organization_audit_events_participant_profile_idx
  on public.organization_audit_events (participant_profile_id)
  where participant_profile_id is not null;

update public.organization_audit_events event
set participant_profile_id = access_grant.participant_profile_id
from public.quest_access_grants access_grant
where event.entity_type = 'quest_access_grant'
  and event.entity_id = access_grant.id
  and event.participant_profile_id is null;

create or replace function public.set_audit_event_participant_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.participant_profile_id is null and new.entity_type = 'quest_access_grant' then
    select access_grant.participant_profile_id
    into new.participant_profile_id
    from public.quest_access_grants access_grant
    where access_grant.id = new.entity_id;
  end if;

  return new;
end;
$$;

revoke all on function public.set_audit_event_participant_profile() from public;

create trigger organization_audit_events_set_participant_profile
before insert or update of entity_id, entity_type, participant_profile_id
on public.organization_audit_events
for each row execute function public.set_audit_event_participant_profile();

drop function public.get_organization_audit_feed(uuid, integer);

create function public.get_organization_audit_feed(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id bigint,
  actor_user_id uuid,
  actor_username text,
  participant_display_name text,
  action text,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  can_read_participants boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.has_organization_permission(p_organization_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'organization audit access denied';
  end if;

  can_read_participants := public.has_organization_permission(
    p_organization_id,
    'participants.read'
  );

  return query
  select
    event.id,
    event.actor_user_id,
    actor.username as actor_username,
    case when can_read_participants then participant.display_name else null end,
    event.action,
    event.entity_type,
    event.entity_id,
    event.metadata - array['token', 'token_hash', 'email', 'participant_profile_id'],
    event.created_at
  from public.organization_audit_events event
  left join public.profiles actor on actor.id = event.actor_user_id
  left join public.participant_profiles participant on participant.id = event.participant_profile_id
  where event.organization_id = p_organization_id
  order by event.created_at desc, event.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.get_organization_audit_feed(uuid, integer) from public;
grant execute on function public.get_organization_audit_feed(uuid, integer) to authenticated;
