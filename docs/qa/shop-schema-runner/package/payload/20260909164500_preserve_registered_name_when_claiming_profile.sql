-- When a newly registered account claims a dependent profile, keep the name
-- of its automatically provisioned personal profile while moving history and
-- memberships to the claimed stable profile id.

create or replace function public.preserve_registered_participant_name_on_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registered_name text;
begin
  if new.relationship <> 'self' or new.status <> 'active'
     or new.participant_profile_id = new.user_id then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.relationship = 'self' and old.status = 'active' then
    return new;
  end if;

  select participant.display_name
  into registered_name
  from public.participant_profiles participant
  where participant.created_by_user_id = new.user_id
    and participant.profile_kind = 'self'
    and participant.status = 'archived'
    and participant.id <> new.participant_profile_id
  order by participant.updated_at desc, participant.created_at desc
  limit 1;

  if registered_name is not null then
    update public.participant_profiles participant
    set display_name = registered_name,
        updated_at = now()
    where participant.id = new.participant_profile_id;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_registered_participant_name_on_claim
on public.participant_profile_accounts;
create trigger preserve_registered_participant_name_on_claim
after insert or update of relationship, status
on public.participant_profile_accounts
for each row execute function public.preserve_registered_participant_name_on_claim();

revoke all on function public.preserve_registered_participant_name_on_claim() from public, anon, authenticated;
