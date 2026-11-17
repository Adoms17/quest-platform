begin;
-- Only a trusted HTTP 400 invalid_request may release an authorized reservation.
create function platform_private.reject_subscription_refund(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; f public.billing_sandbox_refunds%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 perform public.require_platform_owner();
 select r.organization_id into org from public.subscription_refund_requests r join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id=p_refund_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 perform 1 from public.organization_subscriptions where organization_id=org for update;
 perform 1 from public.billing_sandbox_orders o join public.billing_sandbox_refunds r on r.order_id=o.id where r.id=p_refund_id for update of o;
 select * into f from public.billing_sandbox_refunds where id=p_refund_id for update;
 if f.state='rejected' then return to_jsonb(f); end if;
 if f.state<>'sending' or f.provider_refund_id is not null or f.first_sent_at is null
 or not exists(select 1 from public.subscription_refund_dispatches d where d.refund_id=f.id and d.authorized_at=f.first_sent_at)
 or exists(select 1 from public.subscription_refund_applications a where a.refund_id=f.id) then
 raise exception 'subscription refund rejection conflict' using errcode='55000'; end if;
 update public.billing_sandbox_refunds set state='rejected',updated_at=clock_timestamp() where id=f.id returning * into f;
 return to_jsonb(f);
end; $$;
revoke all on function platform_private.reject_subscription_refund(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='if exists(select 1 from public.subscription_refund_reservations where refund_id=old.id) then';
begin
 definition:=pg_get_functiondef('platform_private.block_unintegrated_subscription_refund()'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund rejection gate marker missing'; end if;
 execute replace(definition,marker,marker||'
 if old.state=''sending'' and old.provider_refund_id is null and new.state=''rejected''
 and (to_jsonb(new)-''state''-''updated_at'')=(to_jsonb(old)-''state''-''updated_at'')
 and exists(select 1 from public.subscription_refund_dispatches d where d.refund_id=old.id and d.authorized_at=old.first_sent_at) then return new; end if;');
 definition:=pg_get_functiondef('public.subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb)'::regprocedure);
 if position('elsif p_action=''recover''' in definition)=0 then raise exception 'gateway rejection marker missing'; end if;
 definition:=replace(definition,'''read'',''claim'',''recover'',''record''','''read'',''claim'',''recover'',''record'',''reject''');
 definition:=replace(definition,'elsif p_action=''recover''','elsif p_action=''reject'' then result:=platform_private.reject_subscription_refund(p_refund_id); elsif p_action=''recover''');
 execute definition;
end; $$;
commit;
