-- Resolve the participant after the audit row is inserted. This also works when
-- the grant and its audit event are created inside the same security-definer RPC.

drop trigger if exists organization_audit_events_set_participant_profile
  on public.organization_audit_events;

create or replace function public.set_audit_event_participant_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.participant_profile_id is null and new.entity_type = 'quest_access_grant' then
    update public.organization_audit_events event
    set participant_profile_id = access_grant.participant_profile_id
    from public.quest_access_grants access_grant
    where event.id = new.id
      and access_grant.id = new.entity_id;
  end if;

  return new;
end;
$$;

revoke all on function public.set_audit_event_participant_profile() from public;

create trigger organization_audit_events_set_participant_profile
after insert on public.organization_audit_events
for each row execute function public.set_audit_event_participant_profile();
