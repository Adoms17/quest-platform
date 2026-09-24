begin;
-- Hosted pg_net queue ACLs are extension-managed: never place the long-lived worker token there.
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('platform_private.run_scheduled_sandbox_orders()'::regprocedure);
 marker:='request_id bigint; sent integer:=0;';
 if position(marker in definition)=0 then raise exception 'scheduler declaration changed'; end if;
 definition:=replace(definition,marker,'request_id bigint; signed_at text; signature text; sent integer:=0;');
 marker:='  select net.http_post(';
 if position(marker in definition)=0 then raise exception 'scheduler dispatch changed'; end if;
 definition:=replace(definition,marker,$patch$
  signed_at:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature:=encode(extensions.hmac('qvesta-order-reconcile-v1'||chr(10)||item.order_id::text||chr(10)||signed_at,token,'sha256'),'hex');
  select net.http_post($patch$);
 marker:='''x-qvesta-worker-token'',token,''x-qvesta-order-id'',item.order_id::text';
 if position(marker in definition)=0 then raise exception 'scheduler header changed'; end if;
 definition:=replace(definition,marker,'''x-qvesta-order-signature'',signature,''x-qvesta-order-timestamp'',signed_at,''x-qvesta-order-id'',item.order_id::text');
 execute definition;
end; $$;
commit;