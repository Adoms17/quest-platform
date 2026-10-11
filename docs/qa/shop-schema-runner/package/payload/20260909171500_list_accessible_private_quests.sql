-- List currently open, non-public quests for every participant profile the
-- current actor may use. Access is evaluated on each call, so supervision and
-- group membership changes take effect immediately.

create or replace function public.get_my_accessible_private_quests()
returns table (
  quest_id uuid,
  title text,
  description text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  participants jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    quest.id,
    quest.title,
    quest.description,
    quest.start_at,
    quest.end_at,
    jsonb_agg(jsonb_build_object(
      'participant_profile_id', participant.id,
      'display_name', participant.display_name,
      'relationship', case
        when current_account.user_id is not null then 'self'
        when supervision.supervisor_user_id is not null then 'supervisor'
        else 'group_manager'
      end,
      'account_email', linked_user.email,
      'owner_username', owner_profile.username,
      'owner_email', owner_user.email
    ) order by
      case when current_account.user_id is not null then 0 else 1 end,
      lower(participant.display_name),
      lower(coalesce(linked_user.email::text, owner_user.email::text, '')),
      participant.id
    ) as participants
  from public.quests quest
  join public.quest_access_grants access_grant
    on access_grant.quest_id = quest.id
   and access_grant.status = 'active'
   and (access_grant.expires_at is null or access_grant.expires_at > now())
  join public.participant_profiles participant
    on participant.id = access_grant.participant_profile_id
   and participant.status = 'active'
  left join lateral (
    select account_link.user_id
    from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = participant.id
      and account_link.relationship = 'self'
      and account_link.status = 'active'
    order by account_link.linked_at, account_link.user_id
    limit 1
  ) linked_account on true
  left join auth.users linked_user on linked_user.id = linked_account.user_id
  left join public.participant_profile_accounts current_account
    on current_account.participant_profile_id = participant.id
   and current_account.user_id = auth.uid()
   and current_account.relationship = 'self'
   and current_account.status = 'active'
  left join public.participant_supervisions supervision
    on supervision.participant_profile_id = participant.id
   and supervision.supervisor_user_id = auth.uid()
   and supervision.status = 'active'
  left join public.profiles owner_profile on owner_profile.id = participant.created_by_user_id
  left join auth.users owner_user on owner_user.id = participant.created_by_user_id
  where auth.uid() is not null
    and quest.is_public = false
    and quest.is_open = true
    and (quest.start_at is null or quest.start_at <= now())
    and (quest.end_at is null or quest.end_at >= now())
    and public.can_access_participant_profile(participant.id)
  group by quest.id, quest.title, quest.description, quest.start_at, quest.end_at
  order by lower(quest.title), quest.id;
$$;

revoke all on function public.get_my_accessible_private_quests() from public, anon, authenticated;
grant execute on function public.get_my_accessible_private_quests() to authenticated;
