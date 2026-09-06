-- Allow quest owners to choose ALL or ANY semantics when both GPS and code
-- are configured. Existing quests retain the stricter ALL behavior.

alter table public.quests
  add column verification_match_policy text not null default 'all',
  add constraint quests_verification_match_policy_check
    check (verification_match_policy in ('all', 'any'));

do $migration$
declare
  function_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.submit_task_event(uuid,uuid,uuid,text,text,double precision,double precision,integer)'::regprocedure
  )
  into function_definition;

  updated_definition := replace(
    function_definition,
    'event_accepted := gps_ok and code_ok;',
    $replacement$event_accepted := case
      when quest_record.verification_match_policy = 'any'
        and gps_required
        and code_required
      then gps_ok or code_ok
      else gps_ok and code_ok
    end;$replacement$
  );

  if updated_definition = function_definition then
    raise exception 'submit_task_event verification expression was not found';
  end if;

  execute updated_definition;
end
$migration$;
