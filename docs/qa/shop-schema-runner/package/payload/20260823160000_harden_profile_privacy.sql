-- Keep email addresses out of public profile data and restrict profile reads.

update public.profiles
set username = null
where username ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data->>'username'), ''),
    null
  );
  return new;
exception
  when others then
    raise log 'Error creating profile for user %: %', new.id, sqlerrm;
    return new;
end;
$function$;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

drop policy "Enable read access for all users" on public.profiles;

create policy "Users can view own profile"
on public.profiles
as permissive
for select
to authenticated
using (id = auth.uid());

create policy "Creators can view participant profiles"
on public.profiles
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.quest_attempts
    join public.quests on quests.id = quest_attempts.quest_id
    where quest_attempts.user_id = profiles.id
      and quests.creator_id = auth.uid()
  )
);
