-- Separate authenticated actors from the people who participate in quests.

create table public.participant_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  profile_kind text not null default 'dependent' check (profile_kind in ('self', 'dependent')),
  age_group text not null default 'unknown' check (age_group in ('unknown', 'child', 'teen', 'adult')),
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.participant_profile_accounts (
  participant_profile_id uuid not null references public.participant_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  relationship text not null check (relationship in ('self', 'supervisor')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  linked_at timestamp with time zone not null default now(),
  revoked_at timestamp with time zone,
  primary key (participant_profile_id, user_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index participant_profile_one_self_account_idx
  on public.participant_profile_accounts (participant_profile_id)
  where relationship = 'self' and status = 'active';

create table public.participant_supervisions (
  supervisor_user_id uuid not null references public.profiles(id) on delete cascade,
  participant_profile_id uuid not null references public.participant_profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (supervisor_user_id, participant_profile_id)
);

create table public.participant_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.participant_group_members (
  group_id uuid not null references public.participant_groups(id) on delete cascade,
  participant_profile_id uuid not null references public.participant_profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('leader', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamp with time zone not null default now(),
  primary key (group_id, participant_profile_id)
);

create or replace function public.provision_self_participant_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
  values (new.id, coalesce(nullif(btrim(new.username), ''), 'Пользователь'), 'self', 'unknown', new.id)
  on conflict (id) do nothing;

  insert into public.participant_profile_accounts (participant_profile_id, user_id, relationship)
  values (new.id, new.id, 'self')
  on conflict (participant_profile_id, user_id) do nothing;
  return new;
end;
$$;

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
select profile.id, coalesce(nullif(btrim(profile.username), ''), 'Пользователь'), 'self', 'unknown', profile.id
from public.profiles profile
on conflict (id) do nothing;

insert into public.participant_profile_accounts (participant_profile_id, user_id, relationship)
select profile.id, profile.id, 'self'
from public.profiles profile
on conflict (participant_profile_id, user_id) do nothing;

create trigger provision_self_participant_profile_after_profile_insert
after insert on public.profiles
for each row execute function public.provision_self_participant_profile();

create or replace function public.can_access_participant_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.participant_profile_accounts account_link
      where account_link.participant_profile_id = target_profile_id
        and account_link.user_id = auth.uid()
        and account_link.status = 'active'
    )
    or exists (
      select 1 from public.participant_supervisions supervision
      where supervision.participant_profile_id = target_profile_id
        and supervision.supervisor_user_id = auth.uid()
        and supervision.status = 'active'
    )
  );
$$;

create or replace function public.can_access_participant_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.participant_groups participant_group
      where participant_group.id = target_group_id
        and participant_group.created_by_user_id = auth.uid()
    )
    or exists (
      select 1 from public.participant_group_members group_member
      where group_member.group_id = target_group_id
        and group_member.status = 'active'
        and public.can_access_participant_profile(group_member.participant_profile_id)
    )
  );
$$;

alter table public.participant_profiles enable row level security;
alter table public.participant_profile_accounts enable row level security;
alter table public.participant_supervisions enable row level security;
alter table public.participant_groups enable row level security;
alter table public.participant_group_members enable row level security;

create policy "Users can read accessible participant profiles"
on public.participant_profiles for select to authenticated
using (public.can_access_participant_profile(id));

create policy "Users can read accessible participant account links"
on public.participant_profile_accounts for select to authenticated
using (user_id = auth.uid() or public.can_access_participant_profile(participant_profile_id));

create policy "Users can read own participant supervision"
on public.participant_supervisions for select to authenticated
using (
  supervisor_user_id = auth.uid()
  or public.can_access_participant_profile(participant_profile_id)
);

create policy "Users can read accessible participant groups"
on public.participant_groups for select to authenticated
using (public.can_access_participant_group(id));

create policy "Users can read accessible participant group members"
on public.participant_group_members for select to authenticated
using (public.can_access_participant_group(group_id));

revoke all on function public.provision_self_participant_profile() from public, anon, authenticated;
revoke all on function public.can_access_participant_profile(uuid) from public;
revoke all on function public.can_access_participant_group(uuid) from public;
grant execute on function public.can_access_participant_profile(uuid) to authenticated;
grant execute on function public.can_access_participant_group(uuid) to authenticated;

revoke all on public.participant_profiles from anon, authenticated;
revoke all on public.participant_profile_accounts from anon, authenticated;
revoke all on public.participant_supervisions from anon, authenticated;
revoke all on public.participant_groups from anon, authenticated;
revoke all on public.participant_group_members from anon, authenticated;
grant select on public.participant_profiles to authenticated;
grant select on public.participant_profile_accounts to authenticated;
grant select on public.participant_supervisions to authenticated;
grant select on public.participant_groups to authenticated;
grant select on public.participant_group_members to authenticated;
