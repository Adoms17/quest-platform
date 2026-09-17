begin;
-- Отдельный закрытый допуск оператора платформы. billing.manage организации недостаточно.
create table public.billing_sandbox_refund_operators(actor_id uuid primary key references auth.users(id) on delete restrict);
create table public.billing_sandbox_refunds(
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.billing_sandbox_orders(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict, command_id uuid not null,
 amount_minor bigint not null check(amount_minor>0), payment_id uuid not null,
 state text not null default 'reserved' check(state in ('reserved','sending','pending','succeeded','canceled','rejected','review')),
 provider_refund_id uuid unique, first_sent_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(actor_id,command_id)
);
alter table public.billing_sandbox_refund_operators enable row level security;
alter table public.billing_sandbox_refunds enable row level security;
revoke all on public.billing_sandbox_refund_operators,public.billing_sandbox_refunds from public,anon,authenticated,service_role;

create function public.preview_sandbox_refund(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; r public.billing_sandbox_payment_results%rowtype; used bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.billing_sandbox_refund_operators where actor_id=auth.uid()) then raise exception 'platform refund denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id) then raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
 select * into r from public.billing_sandbox_payment_results where order_id=o.id;
 if r.order_id is null or r.status<>'succeeded' or not r.paid or r.requires_review then raise exception 'sandbox payment not refundable' using errcode='22023'; end if;
 select coalesce(sum(amount_minor),0) into used from public.billing_sandbox_refunds where order_id=o.id and state not in ('canceled','rejected');
 return jsonb_build_object('order_id',o.id,'payment_id',r.payment_id,'amount_minor',o.amount_minor,'available_minor',o.amount_minor-used,'currency',o.currency,'environment','sandbox','access_effect','unchanged');
end;$$;

create function public.reserve_sandbox_refund(p_order_id uuid,p_command_id uuid,p_amount_minor bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare preview jsonb; prior public.billing_sandbox_refunds%rowtype; result uuid;
begin
 if p_command_id is null or p_amount_minor is null or p_amount_minor<=0 then raise exception 'invalid refund command' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':refund:'||p_command_id::text,0));
 preview:=public.preview_sandbox_refund(p_order_id);
 select * into prior from public.billing_sandbox_refunds where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if prior.order_id<>p_order_id or prior.amount_minor<>p_amount_minor then raise exception 'refund command conflict' using errcode='22023'; end if;
  return prior.id;
 end if;
 if p_amount_minor>(preview->>'available_minor')::bigint then raise exception 'refund amount exceeded' using errcode='22023'; end if;
 insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id)
 values(p_order_id,auth.uid(),p_command_id,p_amount_minor,(preview->>'payment_id')::uuid) returning id into result;
 return result;
end;$$;

create function public.read_sandbox_refund(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; o jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.billing_sandbox_refund_operators where actor_id=auth.uid()) then raise exception 'platform refund denied' using errcode='42501'; end if;
 select * into r from public.billing_sandbox_refunds where id=p_refund_id;
 if not found then raise exception 'sandbox refund missing' using errcode='22023'; end if;
 o:=public.read_sandbox_reconciliation_order((select shop_id from public.billing_sandbox_orders where id=r.order_id),r.order_id,r.payment_id);
 return jsonb_build_object('refund',to_jsonb(r),'order',o);
end;$$;

create function public.begin_sandbox_refund(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; snapshot jsonb;
begin
 snapshot:=public.read_sandbox_refund(p_refund_id);
 -- Общая блокировка заказа сериализует резервирование суммы и начало отправки.
 perform 1 from public.billing_sandbox_orders where id=(snapshot->'refund'->>'order_id')::uuid for update;
 select * into r from public.billing_sandbox_refunds where id=p_refund_id for update;
 perform public.preview_sandbox_refund(r.order_id);
 if r.provider_refund_id is not null or r.state in ('succeeded','canceled','rejected','review') then return jsonb_build_object('can_send',false); end if;
 if r.first_sent_at is not null and clock_timestamp()>=r.first_sent_at+interval '23 hours' then
  update public.billing_sandbox_refunds set state='review',updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('can_send',false);
 end if;
 update public.billing_sandbox_refunds set state='sending',first_sent_at=coalesce(first_sent_at,clock_timestamp()),updated_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('can_send',true,'snapshot',public.read_sandbox_refund(r.id));
end;$$;

create function public.record_sandbox_refund(p_refund_id uuid,p_provider_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; snapshot jsonb;
begin
 snapshot:=public.read_sandbox_refund(p_refund_id);
 perform 1 from public.billing_sandbox_orders where id=(snapshot->'refund'->>'order_id')::uuid for update;
 select * into r from public.billing_sandbox_refunds where id=p_refund_id for update;
 if p_provider_id is null or p_status is null or p_status not in ('pending','succeeded','canceled') or r.first_sent_at is null then raise exception 'invalid refund result' using errcode='22023'; end if;
 if r.provider_refund_id is not null and r.provider_refund_id<>p_provider_id then raise exception 'refund identity conflict' using errcode='22023'; end if;
 if r.state in ('succeeded','canceled') then
  if p_status<>'pending' and p_status<>r.state then update public.billing_sandbox_refunds set state='review',updated_at=clock_timestamp() where id=r.id returning * into r; end if;
  return to_jsonb(r);
 end if;
 if r.state in ('review','rejected') then return to_jsonb(r); end if;
 update public.billing_sandbox_refunds set provider_refund_id=p_provider_id,state=p_status,updated_at=clock_timestamp() where id=r.id returning * into r;
 -- Возврат денег не изменяет подписку, квоты или результаты прохождения.
 return to_jsonb(r);
end;$$;
create function public.reject_sandbox_refund(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; snapshot jsonb;
begin
 snapshot:=public.read_sandbox_refund(p_refund_id);
 perform 1 from public.billing_sandbox_orders where id=(snapshot->'refund'->>'order_id')::uuid for update;
 select * into r from public.billing_sandbox_refunds where id=p_refund_id for update;
 -- Только подтверждённый invalid_request HTTP 400; timeout/5xx сюда не передаются.
 if r.state='sending' and r.provider_refund_id is null then
  update public.billing_sandbox_refunds set state='rejected',updated_at=clock_timestamp() where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.reject_sandbox_refund(uuid) from public,anon,authenticated;
grant execute on function public.reject_sandbox_refund(uuid) to service_role;
revoke all on function public.preview_sandbox_refund(uuid),public.reserve_sandbox_refund(uuid,uuid,bigint),public.read_sandbox_refund(uuid),public.begin_sandbox_refund(uuid),public.record_sandbox_refund(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.preview_sandbox_refund(uuid),public.reserve_sandbox_refund(uuid,uuid,bigint),public.read_sandbox_refund(uuid),public.begin_sandbox_refund(uuid),public.record_sandbox_refund(uuid,uuid,text) to service_role;
commit;
