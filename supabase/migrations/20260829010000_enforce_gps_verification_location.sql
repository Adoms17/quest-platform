-- GPS verification depends on GPS coordinates being part of the task location description.
-- Fail loudly instead of silently rewriting existing quest configuration.
do $$
begin
  if exists (
    select 1
    from public.quests
    where coalesce(verification_options ? 'gps', false)
      and not coalesce(location_options ? 'gps', false)
  ) then
    raise exception
      'Cannot enforce GPS verification consistency: incompatible quests exist';
  end if;
end
$$;

alter table public.quests
  add constraint quests_gps_verification_requires_location_check
  check (
    not coalesce(verification_options ? 'gps', false)
    or coalesce(location_options ? 'gps', false)
  );