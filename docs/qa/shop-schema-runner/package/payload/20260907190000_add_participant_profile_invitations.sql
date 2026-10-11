-- Email-bound invitations for an additional supervisor or claiming a dependent profile.

create unique index participant_account_one_active_self_profile_idx
  on public.participant_profile_accounts (user_id)
  where relationship = 'self' and status = 'active';

create table public.participant_profile_invitations (
  id uuid primary key default gen_random_uuid(),
  participant_profile_id uuid not null references public.participant_profiles(id) on delete cascade,
  invitation_kind text not null check (invitation_kind in ('supervisor', 'claim')),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  accepted_by_user_id uuid references public.profiles(id) on delete restrict,
  expires_at timestamp with time zone not null,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (expires_at > created_at),
  check ((status = 'accepted') = (accepted_by_user_id is not null and accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index participant_profile_pending_invitation_idx
  on public.participant_profile_invitations (participant_profile_id, invitation_kind, email)
  where status = 'pending';

alter table public.participant_profile_invitations enable row level security;
revoke all on public.participant_profile_invitations from anon, authenticated;

create or replace function public.create_participant_profile_invitation(
  p_participant_profile_id uuid,
  p_invitation_kind text,
  p_email text,
  p_expires_at timestamp with time zone default (now() + interval '7 days')
)
returns table (invitation_id uuid, invitation_token text, expires_at timestamp with time zone)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  normalized_email text := lower(btrim(p_email));
  generated_token text := encode(extensions.gen_random_bytes(32), 'hex');
  created_invitation public.participant_profile_invitations%rowtype;
  target_profile public.participant_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select * into target_profile from public.participant_profiles where id = p_participant_profile_id;
  if not found or target_profile.profile_kind <> 'dependent' or target_profile.status <> 'active'
     or not exists (
       select 1 from public.participant_supervisions supervision
       where supervision.participant_profile_id = p_participant_profile_id
         and supervision.supervisor_user_id = auth.uid()
         and supervision.status = 'active'
     ) then
    raise exception using errcode = '42501', message = 'participant invitation management denied';
  end if;
  if p_invitation_kind not in ('supervisor', 'claim') then
    raise exception using errcode = '22023', message = 'invalid participant invitation kind';
  end if;
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid participant invitation email';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'invalid participant invitation expiry';
  end if;
  if p_invitation_kind = 'claim' and exists (
    select 1 from public.participant_profile_accounts account_link
    where account_link.participant_profile_id = p_participant_profile_id
      and account_link.relationship = 'self' and account_link.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'participant profile already has an account';
  end if;

  insert into public.participant_profile_invitations (
    participant_profile_id, invitation_kind, email, token_hash, created_by_user_id, expires_at
  ) values (
    p_participant_profile_id, p_invitation_kind, normalized_email,
    encode(extensions.digest(convert_to(generated_token, 'UTF8'), 'sha256'), 'hex'),
    auth.uid(), p_expires_at
  ) returning * into created_invitation;

  return query select created_invitation.id, generated_token, created_invitation.expires_at;
end;
$$;

create or replace function public.get_my_participant_profile_invitations()
returns table (
  invitation_id uuid,
  participant_profile_id uuid,
  participant_display_name text,
  invitation_kind text,
  email text,
  status text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select invitation.id, invitation.participant_profile_id, participant.display_name,
    invitation.invitation_kind, invitation.email, invitation.status,
    invitation.expires_at, invitation.created_at
  from public.participant_profile_invitations invitation
  join public.participant_profiles participant on participant.id = invitation.participant_profile_id
  where invitation.created_by_user_id = auth.uid()
  order by invitation.created_at desc, invitation.id desc;
$$;

create or replace function public.get_participant_profile_invitation_preview(p_token text)
returns table (invitation_kind text, participant_display_name text, expires_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare current_email text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select lower(email) into current_email from auth.users where id = auth.uid();
  return query
  select invitation.invitation_kind, participant.display_name, invitation.expires_at
  from public.participant_profile_invitations invitation
  join public.participant_profiles participant on participant.id = invitation.participant_profile_id
  where invitation.token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
    and invitation.email = current_email
    and invitation.status = 'pending'
    and invitation.expires_at > now();
end;
$$;

create or replace function public.accept_participant_profile_invitation(p_token text)
returns table (participant_profile_id uuid, invitation_kind text)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation public.participant_profile_invitations%rowtype;
  old_self_profile_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select lower(email) into current_email from auth.users where id = current_user_id;
  select * into invitation from public.participant_profile_invitations candidate
  where candidate.token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found then raise exception using errcode = '22023', message = 'invalid participant invitation'; end if;
  if invitation.status = 'accepted' and invitation.accepted_by_user_id = current_user_id then
    return query select invitation.participant_profile_id, invitation.invitation_kind;
    return;
  end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now() then
    raise exception using errcode = '22023', message = 'participant invitation is not active';
  end if;
  if current_email is null or current_email <> invitation.email then
    raise exception using errcode = '42501', message = 'participant invitation belongs to another account';
  end if;

  if invitation.invitation_kind = 'supervisor' then
    insert into public.participant_supervisions (supervisor_user_id, participant_profile_id, status)
    values (current_user_id, invitation.participant_profile_id, 'active')
    on conflict on constraint participant_supervisions_pkey do update
      set status = 'active', updated_at = now();
  else
    if exists (
      select 1 from public.participant_profile_accounts account_link
      where account_link.participant_profile_id = invitation.participant_profile_id
        and account_link.relationship = 'self' and account_link.status = 'active'
        and account_link.user_id <> current_user_id
    ) then
      raise exception using errcode = '22023', message = 'participant profile already has an account';
    end if;

    select account_link.participant_profile_id into old_self_profile_id
    from public.participant_profile_accounts account_link
    where account_link.user_id = current_user_id
      and account_link.relationship = 'self' and account_link.status = 'active'
    for update;

    if old_self_profile_id is distinct from invitation.participant_profile_id then
      update public.participant_profile_accounts
      set status = 'revoked', revoked_at = now()
      where user_id = current_user_id and relationship = 'self' and status = 'active';

      insert into public.participant_group_members (group_id, participant_profile_id, member_role, status)
      select group_id, invitation.participant_profile_id, member_role, status
      from public.participant_group_members old_group_member
      where old_group_member.participant_profile_id = old_self_profile_id
      on conflict on constraint participant_group_members_pkey do update set status = excluded.status;

      update public.participant_profiles
      set status = 'archived', updated_at = now()
      where id = old_self_profile_id and profile_kind = 'self' and created_by_user_id = current_user_id;
    end if;

    insert into public.participant_profile_accounts (participant_profile_id, user_id, relationship, status)
    values (invitation.participant_profile_id, current_user_id, 'self', 'active')
    on conflict on constraint participant_profile_accounts_pkey do update
      set relationship = 'self', status = 'active', revoked_at = null;
    update public.participant_profiles set profile_kind = 'self', updated_at = now()
    where id = invitation.participant_profile_id;
  end if;

  update public.participant_profile_invitations
  set status = 'accepted', accepted_by_user_id = current_user_id, accepted_at = now(), updated_at = now()
  where id = invitation.id;
  return query select invitation.participant_profile_id, invitation.invitation_kind;
end;
$$;

create or replace function public.revoke_participant_profile_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.participant_profile_invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = p_invitation_id and created_by_user_id = auth.uid() and status = 'pending';
  if not found then raise exception using errcode = '42501', message = 'participant invitation revocation denied'; end if;
end;
$$;

revoke all on function public.create_participant_profile_invitation(uuid, text, text, timestamp with time zone) from public;
revoke all on function public.get_my_participant_profile_invitations() from public;
revoke all on function public.get_participant_profile_invitation_preview(text) from public;
revoke all on function public.accept_participant_profile_invitation(text) from public;
revoke all on function public.revoke_participant_profile_invitation(uuid) from public;
grant execute on function public.create_participant_profile_invitation(uuid, text, text, timestamp with time zone) to authenticated;
grant execute on function public.get_my_participant_profile_invitations() to authenticated;
grant execute on function public.get_participant_profile_invitation_preview(text) to authenticated;
grant execute on function public.accept_participant_profile_invitation(text) to authenticated;
grant execute on function public.revoke_participant_profile_invitation(uuid) to authenticated;
