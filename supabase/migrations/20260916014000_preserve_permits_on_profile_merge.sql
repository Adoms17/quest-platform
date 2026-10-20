begin;
-- Merge выполняется редко; общая shared-блокировка не сериализует обычные старты.
create function public.resolve_billing_participant_profile(p_profile_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare current_id uuid:=p_profile_id; target uuid; visited uuid[]:='{}'; targets integer;
begin
 loop
  if current_id=any(visited) or cardinality(visited)>32 then raise exception 'participant merge cycle' using errcode='23514'; end if;
  visited:=array_append(visited,current_id);
  select count(*),min(target_profile_id::text)::uuid into targets,target
    from public.participant_usage_profile_merges where source_profile_id=current_id;
  if targets=0 then return current_id; end if;
  if targets<>1 then raise exception 'participant merge ambiguous' using errcode='23514'; end if;
  current_id:=target;
 end loop;
end;
$$;
revoke all on function public.resolve_billing_participant_profile(uuid) from public,anon,authenticated;

create function public.transfer_offline_profile_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(16014000,1);
 if exists(select 1 from public.offline_start_permits old_permit
   where old_permit.participant_profile_id=new.source_profile_id and old_permit.state='reserved'
     and (exists(select 1 from public.offline_start_permits target where target.participant_profile_id=new.target_profile_id
       and target.quest_id=old_permit.quest_id and target.state='reserved')
       or exists(select 1 from public.quest_attempts target where target.participant_profile_id=new.target_profile_id
         and target.quest_id=old_permit.quest_id and target.finished_at is null))) then
   raise exception 'participant merge has conflicting offline permits' using errcode='55000'; end if;
 update public.offline_start_permits set participant_profile_id=new.target_profile_id where participant_profile_id=new.source_profile_id;
 update public.offline_start_permit_requests set participant_profile_id=new.target_profile_id where participant_profile_id=new.source_profile_id;
 update public.offline_attempt_registrations set participant_profile_id=new.target_profile_id where participant_profile_id=new.source_profile_id;
 update public.offline_event_reviews set participant_profile_id=new.target_profile_id where participant_profile_id=new.source_profile_id;
 return new;
end;
$$;
revoke all on function public.transfer_offline_profile_identity() from public,anon,authenticated;
create trigger transfer_offline_profile_identity after insert on public.participant_usage_profile_merges
 for each row execute function public.transfer_offline_profile_identity();

alter function public.accept_participant_profile_invitation(text) rename to accept_participant_profile_invitation_core;
revoke all on function public.accept_participant_profile_invitation_core(text) from public,anon,authenticated,service_role;
create function public.accept_participant_profile_invitation(p_token text)
returns table(participant_profile_id uuid,invitation_kind text) language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(16014000,1);
 return query select * from public.accept_participant_profile_invitation_core(p_token);
end;
$$;
revoke all on function public.accept_participant_profile_invitation(text) from public,anon;
grant execute on function public.accept_participant_profile_invitation(text) to authenticated;

alter function public.prepare_offline_start_permit(uuid,uuid,uuid) rename to prepare_offline_start_permit_core;
revoke all on function public.prepare_offline_start_permit_core(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.prepare_offline_start_permit(p_quest_id uuid,p_participant_profile_id uuid,p_command_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved uuid; result jsonb;
begin
 perform pg_advisory_xact_lock_shared(16014000,1);
 resolved:=public.resolve_billing_participant_profile(p_participant_profile_id);
 result:=public.prepare_offline_start_permit_core(p_quest_id,resolved,p_command_id);
 if result ? 'participant_profile_id' then result:=result||jsonb_build_object('participant_profile_id',p_participant_profile_id); end if;
 return result;
end;
$$;
revoke all on function public.prepare_offline_start_permit(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_offline_start_permit(uuid,uuid,uuid) to service_role;

alter function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) rename to register_permitted_offline_attempt_core;
revoke all on function public.register_permitted_offline_attempt_core(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.register_permitted_offline_attempt(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_permit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved uuid; result jsonb;
begin
 perform pg_advisory_xact_lock_shared(16014000,1);
 resolved:=public.resolve_billing_participant_profile(p_participant_profile_id);
 result:=public.register_permitted_offline_attempt_core(p_quest_id,resolved,p_local_attempt_id,p_permit_id);
 if result ? 'participant_profile_id' then result:=result||jsonb_build_object('participant_profile_id',p_participant_profile_id); end if;
 return result;
end;
$$;
revoke all on function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) to service_role;

alter function public.register_offline_quest_attempt(uuid,uuid,text,uuid) rename to register_offline_quest_attempt_core;
revoke all on function public.register_offline_quest_attempt_core(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.register_offline_quest_attempt(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_existing_attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved uuid; result jsonb;
begin
 perform pg_advisory_xact_lock_shared(16014000,1);
 resolved:=public.resolve_billing_participant_profile(p_participant_profile_id);
 result:=public.register_offline_quest_attempt_core(p_quest_id,resolved,p_local_attempt_id,p_existing_attempt_id);
 if result ? 'participant_profile_id' then result:=result||jsonb_build_object('participant_profile_id',p_participant_profile_id); end if;
 return result;
end;
$$;
revoke all on function public.register_offline_quest_attempt(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.register_offline_quest_attempt(uuid,uuid,text,uuid) to authenticated;

alter function public.preserve_closed_offline_events(uuid,uuid,text,jsonb) rename to preserve_closed_offline_events_core;
revoke all on function public.preserve_closed_offline_events_core(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.preserve_closed_offline_events(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_events jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved uuid; result jsonb;
begin
 perform pg_advisory_xact_lock_shared(16014000,1);
 resolved:=public.resolve_billing_participant_profile(p_participant_profile_id);
 result:=public.preserve_closed_offline_events_core(p_quest_id,resolved,p_local_attempt_id,p_events);
 if result ? 'participant_profile_id' then result:=result||jsonb_build_object('participant_profile_id',p_participant_profile_id); end if;
 return result;
end;
$$;
revoke all on function public.preserve_closed_offline_events(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.preserve_closed_offline_events(uuid,uuid,text,jsonb) to authenticated;

alter function public.start_quest_attempt_for_participant(uuid,uuid) rename to start_quest_attempt_for_participant_core;
revoke all on function public.start_quest_attempt_for_participant_core(uuid,uuid) from public,anon,authenticated,service_role;
create function public.start_quest_attempt_for_participant(p_quest_id uuid,p_participant_profile_id uuid)
returns table (
  id uuid, quest_id uuid, user_id uuid, participant_profile_id uuid,
  started_at timestamp with time zone, finished_at timestamp with time zone,
  total_tasks integer, completed_tasks integer, failed_tasks integer,
  total_attempts integer, total_time integer, percent_success double precision
)
 language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(16014000,1);
 return query select * from public.start_quest_attempt_for_participant_core(p_quest_id,public.resolve_billing_participant_profile(p_participant_profile_id));
end;
$$;
revoke all on function public.start_quest_attempt_for_participant(uuid,uuid) from public,anon;
grant execute on function public.start_quest_attempt_for_participant(uuid,uuid) to authenticated;
alter function public.redeem_offline_start_permit(uuid) rename to redeem_offline_start_permit_core;
revoke all on function public.redeem_offline_start_permit_core(uuid) from public,anon,authenticated,service_role;
create function public.redeem_offline_start_permit(p_permit_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(16014000,1);
 return public.redeem_offline_start_permit_core(p_permit_id);
end;
$$;
revoke all on function public.redeem_offline_start_permit(uuid) from public,anon,authenticated;
grant execute on function public.redeem_offline_start_permit(uuid) to service_role;
commit;
