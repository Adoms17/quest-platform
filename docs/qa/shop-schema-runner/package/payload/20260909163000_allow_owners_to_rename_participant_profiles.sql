-- A profile name belongs to its account holder. Until a dependent profile is
-- claimed by an account, only the user who created it may rename it.

create or replace function public.update_my_participant_profile_name(
  p_participant_profile_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := nullif(btrim(p_display_name), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if normalized_name is null or char_length(normalized_name) > 100 then
    raise exception using errcode = '22023', message = 'invalid participant display name';
  end if;

  update public.participant_profiles participant
  set display_name = normalized_name,
      updated_at = now()
  where participant.id = p_participant_profile_id
    and participant.status = 'active'
    and (
      exists (
        select 1 from public.participant_profile_accounts account_link
        where account_link.participant_profile_id = participant.id
          and account_link.user_id = auth.uid()
          and account_link.relationship = 'self'
          and account_link.status = 'active'
      )
      or (
        participant.created_by_user_id = auth.uid()
        and not exists (
          select 1 from public.participant_profile_accounts claimed_account
          where claimed_account.participant_profile_id = participant.id
            and claimed_account.relationship = 'self'
            and claimed_account.status = 'active'
        )
      )
    );

  if not found then
    raise exception using errcode = '42501', message = 'participant profile rename denied';
  end if;
end;
$$;

revoke all on function public.update_my_participant_profile_name(uuid, text) from public, anon, authenticated;
grant execute on function public.update_my_participant_profile_name(uuid, text) to authenticated;
