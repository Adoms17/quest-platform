create table public.participant_group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.participant_groups(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  accepted_by_user_id uuid references public.profiles(id) on delete restrict,
  expires_at timestamp with time zone not null default (now() + interval '7 days'),
  created_at timestamp with time zone not null default now(),
  accepted_at timestamp with time zone
);
create unique index participant_group_pending_email_idx on public.participant_group_invitations(group_id, email) where status = 'pending';
alter table public.participant_group_invitations enable row level security;
revoke all on public.participant_group_invitations from anon, authenticated;

create function public.create_participant_group_invitation(p_group_id uuid, p_email text)
returns table (invitation_id uuid, invitation_token text, expires_at timestamp with time zone)
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare normalized_email text := lower(btrim(p_email)); generated_token text := encode(extensions.gen_random_bytes(32), 'hex'); created public.participant_group_invitations%rowtype;
begin
  if not public.can_manage_participant_group(p_group_id) then raise exception using errcode = '42501', message = 'participant group management denied'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode = '22023', message = 'invalid participant invitation email'; end if;
  insert into public.participant_group_invitations(group_id,email,token_hash,created_by_user_id)
  values(p_group_id,normalized_email,encode(extensions.digest(convert_to(generated_token,'UTF8'),'sha256'),'hex'),auth.uid()) returning * into created;
  return query select created.id, generated_token, created.expires_at;
end; $$;

create function public.get_my_participant_group_invitations()
returns table(invitation_id uuid, group_id uuid, group_name text, email text, status text, expires_at timestamp with time zone, created_at timestamp with time zone)
language sql stable security definer set search_path = pg_catalog, public as $$
 select invitation.id, invitation.group_id, participant_group.name, invitation.email, invitation.status, invitation.expires_at, invitation.created_at
 from public.participant_group_invitations invitation join public.participant_groups participant_group on participant_group.id=invitation.group_id
 where invitation.created_by_user_id=auth.uid() order by invitation.created_at desc;
$$;

create function public.get_participant_group_invitation_preview(p_token text)
returns table(group_name text, expires_at timestamp with time zone)
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
 select participant_group.name, invitation.expires_at from public.participant_group_invitations invitation
 join public.participant_groups participant_group on participant_group.id=invitation.group_id
 where invitation.token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex')
 and invitation.email=(select lower(email) from auth.users where id=auth.uid()) and invitation.status='pending' and invitation.expires_at>now();
$$;

create function public.accept_participant_group_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare invitation public.participant_group_invitations%rowtype; self_profile_id uuid;
begin
 select * into invitation from public.participant_group_invitations candidate where candidate.token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex') for update;
 if not found or invitation.email<>(select lower(email) from auth.users where id=auth.uid()) or invitation.status<>'pending' or invitation.expires_at<=now() then raise exception using errcode='42501', message='participant group invitation denied'; end if;
 self_profile_id := public.current_self_participant_profile_id();
 if self_profile_id is null then raise exception using errcode='55000', message='self participant profile required'; end if;
 insert into public.participant_group_members(group_id,participant_profile_id,member_role,status) values(invitation.group_id,self_profile_id,'member','active')
 on conflict on constraint participant_group_members_pkey do update set status='active';
 update public.participant_group_invitations set status='accepted',accepted_by_user_id=auth.uid(),accepted_at=now() where id=invitation.id;
 return invitation.group_id;
end; $$;

create function public.leave_participant_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare self_profile_id uuid := public.current_self_participant_profile_id();
begin
 if exists(select 1 from public.participant_groups where id=p_group_id and created_by_user_id=auth.uid()) then raise exception using errcode='22023', message='participant group creator cannot leave'; end if;
 update public.participant_group_members set status='removed' where group_id=p_group_id and participant_profile_id=self_profile_id and status='active';
 if not found then raise exception using errcode='42501', message='participant group membership denied'; end if;
end; $$;

drop function public.get_my_participant_groups();
create function public.get_my_participant_groups()
returns table (group_id uuid, group_name text, group_status text, can_manage boolean, created_by_current_user boolean, members jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
 select participant_group.id,participant_group.name,participant_group.status,public.can_manage_participant_group(participant_group.id),participant_group.created_by_user_id=auth.uid(),coalesce((
 select jsonb_agg(jsonb_build_object('participant_profile_id',participant.id,'display_name',participant.display_name,'age_group',participant.age_group,'profile_kind',participant.profile_kind,'member_role',group_member.member_role,
 'is_current_user',exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=participant.id and a.user_id=auth.uid() and a.status='active'),
 'can_be_group_leader',exists(select 1 from public.participant_profile_accounts a where a.participant_profile_id=participant.id and a.relationship='self' and a.status='active')) order by group_member.member_role,group_member.joined_at)
 from public.participant_group_members group_member join public.participant_profiles participant on participant.id=group_member.participant_profile_id
 where group_member.group_id=participant_group.id and group_member.status='active' and participant.status='active'
 and (public.can_manage_participant_group(participant_group.id) or public.can_access_participant_profile(participant.id))), '[]'::jsonb)
 from public.participant_groups participant_group where participant_group.status='active' and public.can_access_participant_group(participant_group.id) order by participant_group.created_at;
$$;

revoke all on function public.create_participant_group_invitation(uuid,text), public.get_my_participant_group_invitations(), public.get_participant_group_invitation_preview(text), public.accept_participant_group_invitation(text), public.leave_participant_group(uuid) from public,anon,authenticated;
grant execute on function public.get_my_participant_groups() to authenticated;
grant execute on function public.create_participant_group_invitation(uuid,text), public.get_my_participant_group_invitations(), public.get_participant_group_invitation_preview(text), public.accept_participant_group_invitation(text), public.leave_participant_group(uuid) to authenticated;
