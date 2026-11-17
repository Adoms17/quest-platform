begin;
-- Подтверждение резервирует сумму в общем журнале, но не отправляет деньги.
create table public.platform_refund_commands (
 actor_id uuid not null references auth.users(id),
 command_id uuid not null,
 organization_id uuid not null references public.organizations(id),
 order_id uuid not null references public.billing_sandbox_orders(id),
 amount_minor bigint not null check(amount_minor>0),
 reason_code text not null check(reason_code in ('customer_request','duplicate_payment','service_issue')),
 refund_id uuid not null unique references public.billing_sandbox_refunds(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,command_id)
);
alter table public.platform_refund_commands enable row level security;
revoke all on public.platform_refund_commands from public,anon,authenticated,service_role;
create function public.confirm_platform_sandbox_refund(
 p_organization_id uuid,p_order_id uuid,p_amount_minor bigint,p_reason_code text,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.platform_refund_commands%rowtype; preview jsonb; refund uuid;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_order_id is null or p_organization_id is null
 or p_amount_minor is null or p_amount_minor<=0 or p_reason_code is null
 or p_reason_code not in ('customer_request','duplicate_payment','service_issue') then
  raise exception 'invalid refund command' using errcode='22023';
 end if;
 -- Совпадает с блокировкой старого reserve_sandbox_refund.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':refund:'||p_command_id::text,0));
 select * into prior from public.platform_refund_commands where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.organization_id<>p_organization_id or prior.order_id<>p_order_id
  or prior.amount_minor<>p_amount_minor or prior.reason_code<>p_reason_code then
   raise exception 'refund command conflict' using errcode='22023';
  end if;
  return jsonb_build_object('refund_id',prior.refund_id,'already_confirmed',true,'access_effect','unchanged','environment','sandbox');
 end if;
 -- Не присваивать новую команду резерву, созданному прежним операторским путём.
 if exists(select 1 from public.billing_sandbox_refunds where actor_id=auth.uid() and command_id=p_command_id) then
  raise exception 'refund command conflict' using errcode='22023';
 end if;
 -- Preview блокирует заказ до конца транзакции; параллельные резервы видят новый остаток.
 preview:=public.preview_platform_sandbox_refund(p_organization_id,p_order_id,p_amount_minor);
 insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id)
 values(p_order_id,auth.uid(),p_command_id,p_amount_minor,(preview->>'payment_id')::uuid) returning id into refund;
 insert into public.platform_refund_commands(actor_id,command_id,organization_id,order_id,amount_minor,reason_code,refund_id)
 values(auth.uid(),p_command_id,p_organization_id,p_order_id,p_amount_minor,p_reason_code,refund);
 return jsonb_build_object('refund_id',refund,'already_confirmed',false,'access_effect','unchanged','environment','sandbox');
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.refund.confirm','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.confirm_platform_sandbox_refund(uuid,uuid,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_platform_sandbox_refund(uuid,uuid,bigint,text,uuid) to authenticated;
commit;
