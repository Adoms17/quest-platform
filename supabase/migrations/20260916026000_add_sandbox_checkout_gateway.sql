-- service_role обращается от имени пользователя, JWT которого проверен Edge Function.
begin;
create function public.sandbox_checkout_from_gateway(p_actor_user_id uuid,p_action text,p_order_id uuid,p_payment jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text:=current_setting('request.jwt.claim.sub',true); result jsonb;
begin
 if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id)
   or p_action is null or p_action not in ('read','begin','record') then raise exception 'invalid sandbox gateway request' using errcode='22023'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 begin
   if p_action='read' then result:=public.read_sandbox_payment_order(p_order_id);
   elsif p_action='begin' then result:=public.begin_sandbox_payment_send(p_order_id);
   else
     result:=public.record_sandbox_payment_result(p_order_id,(p_payment->>'paymentId')::uuid,p_payment->>'status',
       (p_payment->>'paid')::boolean,(p_payment->>'test')::boolean,p_payment->>'confirmationUrl');
   end if;
 exception when others then
   perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
   raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 return result;
end;$$;
revoke all on function public.sandbox_checkout_from_gateway(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sandbox_checkout_from_gateway(uuid,text,uuid,jsonb) to service_role;
commit;
