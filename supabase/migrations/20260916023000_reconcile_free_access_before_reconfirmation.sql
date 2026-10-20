-- Кабинет видит конфликт до runner; команда должна согласовывать то же состояние.
begin;
do $$
declare definition text; needle text := 'select * into g from public.billing_trial_access where id=p_access_id and organization_id=p_organization_id;';
begin
  definition := pg_get_functiondef('public.reconfirm_organization_trial(uuid,uuid,uuid,bigint)'::regprocedure);
  if position(needle in definition)=0 then raise exception 'reconfirmation marker missing'; end if;
  execute replace(definition,needle,
    'perform public.advance_organization_trial(p_organization_id); ' ||
    'select * into s from public.organization_subscriptions where organization_id=p_organization_id; ' || needle);
end;
$$;
commit;
