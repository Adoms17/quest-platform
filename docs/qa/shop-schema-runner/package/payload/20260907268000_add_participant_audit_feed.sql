-- Private participant audit trail, isolated from organization staff.

create table public.participant_audit_events (
  id bigint generated always as identity primary key,
  participant_profile_id uuid not null references public.participant_profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in (
    'supervision.added',
    'supervision.status_changed',
    'group.member_added',
    'group.member_role_changed',
    'group.member_removed',
    'invitation.created',
    'invitation.accepted',
    'invitation.revoked'
  )),
  entity_type text not null check (entity_type in ('supervision', 'group', 'invitation')),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (not (metadata ?| array['email', 'phone', 'token', 'token_hash', 'latitude', 'longitude']))
);

create index participant_audit_events_profile_created_idx
  on public.participant_audit_events (participant_profile_id, created_at desc, id desc);

alter table public.participant_audit_events enable row level security;
revoke all on public.participant_audit_events from public, anon, authenticated;

create or replace function public.audit_participant_supervision_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare audit_action text;
begin
  if tg_op = 'INSERT' then
    audit_action := 'supervision.added';
  elsif new.status is distinct from old.status then
    audit_action := 'supervision.status_changed';
  else
    return new;
  end if;

  insert into public.participant_audit_events (
    participant_profile_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    new.participant_profile_id, auth.uid(), audit_action, 'supervision',
    new.supervisor_user_id, jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;

create trigger participant_supervisions_write_audit
after insert or update on public.participant_supervisions
for each row execute function public.audit_participant_supervision_change();

create or replace function public.audit_participant_group_member_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare audit_action text;
begin
  if tg_op = 'INSERT' then
    audit_action := 'group.member_added';
  elsif new.status = 'removed' and old.status is distinct from new.status then
    audit_action := 'group.member_removed';
  elsif new.member_role is distinct from old.member_role then
    audit_action := 'group.member_role_changed';
  elsif new.status = 'active' and old.status is distinct from new.status then
    audit_action := 'group.member_added';
  else
    return new;
  end if;

  insert into public.participant_audit_events (
    participant_profile_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    new.participant_profile_id, auth.uid(), audit_action, 'group', new.group_id,
    jsonb_build_object('member_role', new.member_role, 'status', new.status)
  );
  return new;
end;
$$;

create trigger participant_group_members_write_audit
after insert or update on public.participant_group_members
for each row execute function public.audit_participant_group_member_change();

create or replace function public.audit_participant_invitation_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare audit_action text;
begin
  if tg_op = 'INSERT' then
    audit_action := 'invitation.created';
  elsif new.status = 'accepted' and old.status is distinct from new.status then
    audit_action := 'invitation.accepted';
  elsif new.status = 'revoked' and old.status is distinct from new.status then
    audit_action := 'invitation.revoked';
  else
    return new;
  end if;

  insert into public.participant_audit_events (
    participant_profile_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    new.participant_profile_id, auth.uid(), audit_action, 'invitation', new.id,
    jsonb_build_object('invitation_kind', new.invitation_kind, 'status', new.status)
  );
  return new;
end;
$$;

create trigger participant_profile_invitations_write_audit
after insert or update on public.participant_profile_invitations
for each row execute function public.audit_participant_invitation_change();

create or replace function public.get_my_participant_audit_feed(p_limit integer default 50)
returns table (
  id bigint,
  participant_profile_id uuid,
  participant_display_name text,
  actor_username text,
  subject_username text,
  action text,
  entity_type text,
  metadata jsonb,
  created_at timestamp with time zone
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    event.id,
    event.participant_profile_id,
    participant.display_name,
    actor.username,
    case when event.entity_type = 'supervision' then subject.username else null end,
    event.action,
    event.entity_type,
    event.metadata - array['email', 'phone', 'token', 'token_hash', 'latitude', 'longitude'],
    event.created_at
  from public.participant_audit_events event
  join public.participant_profiles participant on participant.id = event.participant_profile_id
  left join public.profiles actor on actor.id = event.actor_user_id
  left join public.profiles subject
    on event.entity_type = 'supervision' and subject.id = event.entity_id
  where public.can_manage_participant_supervisors(event.participant_profile_id)
  order by event.created_at desc, event.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.audit_participant_supervision_change() from public, anon, authenticated;
revoke all on function public.audit_participant_group_member_change() from public, anon, authenticated;
revoke all on function public.audit_participant_invitation_change() from public, anon, authenticated;
revoke all on function public.get_my_participant_audit_feed(integer) from public;
grant execute on function public.get_my_participant_audit_feed(integer) to authenticated;
