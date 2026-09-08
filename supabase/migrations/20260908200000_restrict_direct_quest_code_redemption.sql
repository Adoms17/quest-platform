-- Short quest codes must be redeemed through the rate-limited Edge gateway.

revoke execute on function public.redeem_quest_access_code(text)
  from authenticated;
revoke execute on function public.redeem_quest_access_code_for_participant(text, uuid)
  from authenticated;

grant execute on function public.redeem_quest_access_code(text)
  to service_role;
grant execute on function public.redeem_quest_access_code_for_participant(text, uuid)
  to service_role;
