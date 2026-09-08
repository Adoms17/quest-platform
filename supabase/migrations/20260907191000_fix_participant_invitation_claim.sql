-- Remove PL/pgSQL output-column ambiguity from supervisor and claim upserts.

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
      update public.participant_profile_accounts account_link
      set status = 'revoked', revoked_at = now()
      where account_link.user_id = current_user_id
        and account_link.relationship = 'self' and account_link.status = 'active';

      insert into public.participant_group_members (group_id, participant_profile_id, member_role, status)
      select old_group_member.group_id, invitation.participant_profile_id,
        old_group_member.member_role, old_group_member.status
      from public.participant_group_members old_group_member
      where old_group_member.participant_profile_id = old_self_profile_id
      on conflict on constraint participant_group_members_pkey do update set status = excluded.status;

      update public.participant_profiles participant
      set status = 'archived', updated_at = now()
      where participant.id = old_self_profile_id
        and participant.profile_kind = 'self'
        and participant.created_by_user_id = current_user_id;
    end if;

    insert into public.participant_profile_accounts (participant_profile_id, user_id, relationship, status)
    values (invitation.participant_profile_id, current_user_id, 'self', 'active')
    on conflict on constraint participant_profile_accounts_pkey do update
      set relationship = 'self', status = 'active', revoked_at = null;
    update public.participant_profiles participant
    set profile_kind = 'self', updated_at = now()
    where participant.id = invitation.participant_profile_id;
  end if;

  update public.participant_profile_invitations target_invitation
  set status = 'accepted', accepted_by_user_id = current_user_id,
    accepted_at = now(), updated_at = now()
  where target_invitation.id = invitation.id;
  return query select invitation.participant_profile_id, invitation.invitation_kind;
end;
$$;
