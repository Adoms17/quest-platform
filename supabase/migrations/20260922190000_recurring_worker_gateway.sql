begin;
-- Только серверный service_role. Каждая RPC завершается отдельной транзакцией
-- PostgREST: успешный ответ claim означает зафиксированное разрешение.
create function public.sandbox_recurring_worker_command(p_order_id uuid,p_action text,p_key uuid default null,p_payment jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 case p_action
 when 'begin' then return platform_private.begin_recurring_attempt(p_order_id);
 when 'read' then return platform_private.read_recurring_attempt(p_order_id);
 when 'claim' then return jsonb_build_object('authorized',platform_private.claim_recurring_dispatch(p_order_id,p_key));
 when 'record' then return platform_private.record_recurring_result(p_order_id,p_payment);
 else raise exception 'invalid recurring command' using errcode='22023';
 end case;
end; $$;
revoke all on function public.sandbox_recurring_worker_command(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sandbox_recurring_worker_command(uuid,text,uuid,jsonb) to service_role;
commit;
