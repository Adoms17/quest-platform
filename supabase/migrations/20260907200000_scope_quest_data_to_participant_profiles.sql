-- Introduce participant profile ownership while retaining actor user IDs for compatibility and audit.

alter table public.quest_access_grants add column participant_profile_id uuid;
update public.quest_access_grants set participant_profile_id = user_id where participant_profile_id is null;
alter table public.quest_access_grants alter column participant_profile_id set not null;
alter table public.quest_access_grants add constraint quest_access_grants_participant_profile_id_fkey
  foreign key (participant_profile_id) references public.participant_profiles(id) on delete cascade;

drop index public.quest_access_grants_active_user_idx;
create unique index quest_access_grants_active_participant_idx
  on public.quest_access_grants (quest_id, participant_profile_id) where status = 'active';
create index quest_access_grants_participant_idx
  on public.quest_access_grants (participant_profile_id, granted_at desc);

alter table public.quest_attempts add column actor_user_id uuid;
alter table public.quest_attempts add column participant_profile_id uuid;
update public.quest_attempts
set actor_user_id = user_id, participant_profile_id = user_id
where actor_user_id is null or participant_profile_id is null;
alter table public.quest_attempts alter column actor_user_id set not null;
alter table public.quest_attempts alter column participant_profile_id set not null;
alter table public.quest_attempts add constraint quest_attempts_actor_user_id_fkey
  foreign key (actor_user_id) references public.profiles(id) on delete restrict;
alter table public.quest_attempts add constraint quest_attempts_participant_profile_id_fkey
  foreign key (participant_profile_id) references public.participant_profiles(id) on delete restrict;
create index quest_attempts_participant_quest_idx
  on public.quest_attempts (participant_profile_id, quest_id, created_at desc);

drop index public.quest_attempts_one_active_per_user;
create unique index quest_attempts_one_active_per_participant
  on public.quest_attempts (quest_id, participant_profile_id)
  where finished_at is null;

create or replace function public.current_self_participant_profile_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select account_link.participant_profile_id
  from public.participant_profile_accounts account_link
  join public.participant_profiles participant on participant.id = account_link.participant_profile_id
  where account_link.user_id = auth.uid()
    and account_link.relationship = 'self'
    and account_link.status = 'active'
    and participant.status = 'active'
  limit 1;
$$;

create or replace function public.can_actor_access_quest(
  target_quest_id uuid,
  target_participant_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.can_access_participant_profile(target_participant_profile_id)
    and exists (
      select 1 from public.quests quest
      where quest.id = target_quest_id and (
        quest.is_public
        or exists (
          select 1 from public.quest_access_grants access_grant
          where access_grant.quest_id = quest.id
            and access_grant.participant_profile_id = target_participant_profile_id
            and access_grant.status = 'active'
            and (access_grant.expires_at is null or access_grant.expires_at > now())
        )
      )
    );
$$;

create or replace function public.can_access_quest(target_quest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.can_actor_access_quest(
    target_quest_id,
    public.current_self_participant_profile_id()
  );
$$;

create or replace function public.fill_quest_participant_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'quest_access_grants' then
    new.participant_profile_id := coalesce(
      new.participant_profile_id,
      (select account_link.participant_profile_id
       from public.participant_profile_accounts account_link
       where account_link.user_id = new.user_id
         and account_link.relationship = 'self' and account_link.status = 'active'
       limit 1),
      new.user_id
    );
  else
    new.actor_user_id := coalesce(new.actor_user_id, new.user_id, auth.uid());
    new.participant_profile_id := coalesce(
      new.participant_profile_id,
      (select account_link.participant_profile_id
       from public.participant_profile_accounts account_link
       where account_link.user_id = new.user_id
         and account_link.relationship = 'self' and account_link.status = 'active'
       limit 1),
      new.user_id
    );
  end if;
  return new;
end;
$$;

create trigger fill_quest_access_grant_participant_scope
before insert on public.quest_access_grants
for each row execute function public.fill_quest_participant_scope();

create trigger fill_quest_attempt_participant_scope
before insert on public.quest_attempts
for each row execute function public.fill_quest_participant_scope();

drop policy if exists "Users and managers can read quest access grants" on public.quest_access_grants;
create policy "Participants supervisors and managers can read quest access grants"
on public.quest_access_grants for select to authenticated
using (
  public.can_access_participant_profile(participant_profile_id)
  or public.has_quest_permission(quest_id, 'access_grants.manage')
);

revoke all on function public.current_self_participant_profile_id() from public;
revoke all on function public.can_actor_access_quest(uuid, uuid) from public;
grant execute on function public.current_self_participant_profile_id() to authenticated;
grant execute on function public.can_actor_access_quest(uuid, uuid) to authenticated;
revoke all on function public.fill_quest_participant_scope() from public, anon, authenticated;
