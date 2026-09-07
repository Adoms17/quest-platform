create or replace function public.revoke_quest_access_credential(p_credential_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  target public.quest_access_credentials%rowtype;
  organization_id uuid;
begin
  select * into target from public.quest_access_credentials where id = p_credential_id for update;
  if not found or not public.has_quest_permission(target.quest_id, 'access_grants.manage') then
    raise exception using errcode = '42501', message = 'quest access management denied';
  end if;
  update public.quest_access_credentials set status = 'revoked', revoked_at = now()
  where id = p_credential_id and status = 'active';
  if found then
    select q.organization_id into organization_id from public.quests q where q.id = target.quest_id;
    insert into public.organization_audit_events
      (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (organization_id, auth.uid(), 'quest_access.credential_revoked',
      'quest_access_credential', target.id, jsonb_build_object('quest_id', target.quest_id));
  end if;
end;
$$;
