-- Add participant-scoped access credentials and normalized quest grants.

create table public.quest_access_credentials (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  kind text not null check (kind in ('invitation', 'code', 'link')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text check (email is null or (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamp with time zone,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  revoked_at timestamp with time zone,
  check (expires_at is null or expires_at > created_at),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (max_redemptions is null or redemption_count <= max_redemptions)
);

create index quest_access_credentials_quest_created_idx
  on public.quest_access_credentials (quest_id, created_at desc);

create table public.quest_access_grants (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  credential_id uuid references public.quest_access_credentials(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamp with time zone,
  granted_at timestamp with time zone not null default now(),
  revoked_at timestamp with time zone,
  check (expires_at is null or expires_at > granted_at),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index quest_access_grants_active_user_idx
  on public.quest_access_grants (quest_id, user_id) where status = 'active';
create index quest_access_grants_user_idx
  on public.quest_access_grants (user_id, granted_at desc);

create or replace function public.create_quest_access_credential(
  p_quest_id uuid,
  p_kind text,
  p_email text default null,
  p_max_redemptions integer default 1,
  p_expires_at timestamp with time zone default (now() + interval '7 days')
)
returns table (credential_id uuid, credential_token text, expires_at timestamp with time zone)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  generated_token text := encode(extensions.gen_random_bytes(32), 'hex');
  normalized_email text := nullif(lower(btrim(p_email)), '');
  created public.quest_access_credentials%rowtype;
begin
  if auth.uid() is null or not public.has_quest_permission(p_quest_id, 'access_grants.manage') then
    raise exception using errcode = '42501', message = 'quest access management denied';
  end if;
  if p_kind not in ('invitation', 'code', 'link') then
    raise exception using errcode = '22023', message = 'invalid credential kind';
  end if;
  if p_kind = 'invitation' and normalized_email is null then
    raise exception using errcode = '22023', message = 'invitation email required';
  end if;
  if p_max_redemptions is not null and p_max_redemptions < 1 then
    raise exception using errcode = '22023', message = 'invalid redemption limit';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '90 days') then
    raise exception using errcode = '22023', message = 'invalid credential expiry';
  end if;

  insert into public.quest_access_credentials
    (quest_id, kind, token_hash, email, max_redemptions, expires_at, created_by)
  values
    (p_quest_id, p_kind, encode(extensions.digest(generated_token, 'sha256'), 'hex'),
     normalized_email, p_max_redemptions, p_expires_at, auth.uid())
  returning * into created;

  return query select created.id, generated_token, created.expires_at;
end;
$$;

create or replace function public.redeem_quest_access_credential(p_token text)
returns table (grant_id uuid, quest_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  credential public.quest_access_credentials%rowtype;
  existing_grant public.quest_access_grants%rowtype;
  created_grant public.quest_access_grants%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_token is null or length(p_token) < 32 then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  select * into credential
  from public.quest_access_credentials c
  where c.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or credential.status <> 'active'
     or (credential.expires_at is not null and credential.expires_at <= now()) then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  select * into existing_grant
  from public.quest_access_grants g
  where g.quest_id = credential.quest_id and g.user_id = current_user_id
    and g.status = 'active' and (g.expires_at is null or g.expires_at > now());
  if found then
    return query select existing_grant.id, existing_grant.quest_id;
    return;
  end if;

  if credential.email is not null then
    select lower(email) into current_email from auth.users where id = current_user_id;
    if current_email is distinct from credential.email then
      raise exception using errcode = '42501', message = 'quest access credential belongs to another account';
    end if;
  end if;
  if credential.max_redemptions is not null and credential.redemption_count >= credential.max_redemptions then
    raise exception using errcode = '22023', message = 'invalid quest access credential';
  end if;

  insert into public.quest_access_grants (quest_id, user_id, credential_id, expires_at)
  values (credential.quest_id, current_user_id, credential.id, credential.expires_at)
  returning * into created_grant;
  update public.quest_access_credentials
  set redemption_count = redemption_count + 1
  where id = credential.id;

  return query select created_grant.id, created_grant.quest_id;
end;
$$;

create or replace function public.revoke_quest_access_credential(p_credential_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare target public.quest_access_credentials%rowtype;
begin
  select * into target from public.quest_access_credentials where id = p_credential_id for update;
  if not found or not public.has_quest_permission(target.quest_id, 'access_grants.manage') then
    raise exception using errcode = '42501', message = 'quest access management denied';
  end if;
  update public.quest_access_credentials set status = 'revoked', revoked_at = now()
  where id = p_credential_id and status = 'active';
end;
$$;

create or replace function public.can_access_quest(target_quest_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.quests q where q.id = target_quest_id and (
      q.is_public
      or public.has_organization_permission(q.organization_id, 'quests.read')
      or exists (
        select 1 from public.quest_access_grants g
        where g.quest_id = q.id and g.user_id = auth.uid() and g.status = 'active'
          and (g.expires_at is null or g.expires_at > now())
      )
    )
  );
$$;

alter table public.quest_access_credentials enable row level security;
alter table public.quest_access_grants enable row level security;

create policy "Managers can read quest access credentials"
on public.quest_access_credentials for select to authenticated
using (public.has_quest_permission(quest_id, 'access_grants.manage'));

create policy "Users and managers can read quest access grants"
on public.quest_access_grants for select to authenticated
using (user_id = auth.uid() or public.has_quest_permission(quest_id, 'access_grants.manage'));

grant select on public.quest_access_credentials, public.quest_access_grants to authenticated;
revoke all on function public.create_quest_access_credential(uuid, text, text, integer, timestamp with time zone) from public;
revoke all on function public.redeem_quest_access_credential(text) from public;
revoke all on function public.revoke_quest_access_credential(uuid) from public;
grant execute on function public.create_quest_access_credential(uuid, text, text, integer, timestamp with time zone) to authenticated;
grant execute on function public.redeem_quest_access_credential(text) to authenticated;
grant execute on function public.revoke_quest_access_credential(uuid) to authenticated;
