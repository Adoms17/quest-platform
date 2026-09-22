begin;
-- Старый операторский допуск не распространяется на команды админки.
create or replace function public.read_sandbox_refund(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; o jsonb;
begin
 if exists(select 1 from public.platform_refund_commands where refund_id=p_refund_id) then
  perform public.require_platform_owner();
 else
  if auth.uid() is null or not exists(select 1 from public.billing_sandbox_refund_operators where actor_id=auth.uid()) then
   raise exception 'platform refund denied' using errcode='42501';
  end if;
 end if;
 select * into r from public.billing_sandbox_refunds where id=p_refund_id;
 if not found then raise exception 'sandbox refund missing' using errcode='22023'; end if;
 o:=public.read_sandbox_reconciliation_order((select shop_id from public.billing_sandbox_orders where id=r.order_id),r.order_id,r.payment_id);
 return jsonb_build_object('refund',to_jsonb(r),'order',o);
end;$$;
-- Проверка перед началом отправки без повторного резервирования уже удержанной суммы.
create function platform_private.check_confirmed_refund_payment(p_refund_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 if not exists(
  select 1 from public.platform_refund_commands c
  join public.billing_sandbox_refunds f on f.id=c.refund_id and f.order_id=c.order_id and f.amount_minor=c.amount_minor
  join public.billing_sandbox_orders o on o.id=c.order_id and o.organization_id=c.organization_id
  join public.billing_sandbox_application_scope s on s.organization_id=o.organization_id
  join public.billing_sandbox_payment_results p on p.order_id=o.id and p.payment_id=f.payment_id
  where c.refund_id=p_refund_id and p.status='succeeded' and p.paid and not p.requires_review
 ) then raise exception 'sandbox payment not refundable' using errcode='22023'; end if;
end;$$;
revoke all on function platform_private.check_confirmed_refund_payment(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='perform public.preview_sandbox_refund(r.order_id);';
begin
 definition:=pg_get_functiondef('public.begin_sandbox_refund(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund begin marker missing'; end if;
 execute replace(definition,marker,
 'if exists(select 1 from public.platform_refund_commands where refund_id=r.id) then
   perform platform_private.check_confirmed_refund_payment(r.id);
  else
   perform public.preview_sandbox_refund(r.order_id);
  end if;');
end;$$;
-- CREATE OR REPLACE сохраняет ACL; явно закрепляем серверный доступ.
revoke all on function public.read_sandbox_refund(uuid),public.begin_sandbox_refund(uuid) from public,anon,authenticated;
grant execute on function public.read_sandbox_refund(uuid),public.begin_sandbox_refund(uuid) to service_role;
commit;
