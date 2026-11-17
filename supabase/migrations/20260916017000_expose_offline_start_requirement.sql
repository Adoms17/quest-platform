begin;
do $$
declare signature text; definition text;
begin
 foreach signature in array array['public.get_participant_quest(uuid)','public.get_participant_quest_for_profile(uuid,uuid)'] loop
   definition:=pg_get_functiondef(signature::regprocedure);
   if position('''id'', quest.id,' in definition)=0 then raise exception 'quest projection not found'; end if;
   execute replace(definition,'''id'', quest.id,',
     '''id'', quest.id, ''offline_start_requires_permit'', coalesce((select quest_start_enforcement_enabled from public.organization_subscriptions where organization_id=quest.organization_id),false),');
 end loop;
end;
$$;
commit;
