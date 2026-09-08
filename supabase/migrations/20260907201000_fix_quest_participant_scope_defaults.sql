-- Preserve participant-only access and resolve compatibility defaults from the row owner.

create or replace function public.can_actor_access_quest(
  target_quest_id uuid,
  target_participant_profile_id uuid
)
returns boolean language sql stable security definer
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

create or replace function public.fill_quest_participant_scope()
returns trigger language plpgsql security definer
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
