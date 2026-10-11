begin;
create table public.billing_sandbox_payment_results (
 order_id uuid primary key references public.billing_sandbox_orders(id) on delete restrict,
 shop_id text not null, payment_id uuid not null,
 status text not null check(status in ('pending','waiting_for_capture','succeeded','canceled')),
 paid boolean not null, confirmation_url text,
 requires_review boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(), unique(shop_id,payment_id)
);
alter table public.billing_sandbox_payment_results enable row level security;
revoke all on public.billing_sandbox_payment_results from public,anon,authenticated,service_role;

create function public.record_sandbox_payment_result(p_order_id uuid,p_payment_id uuid,p_status text,p_paid boolean,p_test boolean,p_confirmation_url text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; r public.billing_sandbox_payment_results%rowtype;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found or auth.uid() is null or not public.has_organization_permission(o.organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if p_test is distinct from true or p_payment_id is null or p_status is null or p_status not in ('pending','waiting_for_capture','succeeded','canceled')
   or p_paid is null or (p_status='succeeded' and not p_paid) or o.first_sent_at is null
   or (p_confirmation_url is not null and p_confirmation_url !~ '^https://(yoomoney\.ru|yookassa\.ru)/[^[:space:]]*$') then
   raise exception 'invalid sandbox payment result' using errcode='22023'; end if;
 select * into r from public.billing_sandbox_payment_results where order_id=o.id;
 if found then
   if r.payment_id<>p_payment_id then raise exception 'sandbox payment binding conflict' using errcode='22023'; end if;
   if r.status in ('succeeded','canceled') then
     if p_status in ('succeeded','canceled') and p_status<>r.status then
       update public.billing_sandbox_payment_results set requires_review=true,updated_at=clock_timestamp() where order_id=o.id returning * into r;
       update public.billing_sandbox_orders set state='review' where id=o.id and state<>'finished';
     end if;
     return to_jsonb(r);
   end if;
   if r.status='waiting_for_capture' and p_status='pending' then return to_jsonb(r); end if;
 end if;
 insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid,confirmation_url)
 values(o.id,o.shop_id,p_payment_id,p_status,p_paid,case when p_status='pending' then p_confirmation_url else null end)
 on conflict(order_id) do update set status=excluded.status,paid=excluded.paid,confirmation_url=excluded.confirmation_url,updated_at=clock_timestamp()
 returning * into r;
 -- Успех требует отдельного применения/сверки в 6D-02; здесь прав не выдаём.
 update public.billing_sandbox_orders set state=case when p_status='canceled' then 'finished' when p_status='succeeded' then 'review' else state end where id=o.id;
 return to_jsonb(r);
end;$$;
revoke all on function public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.record_sandbox_payment_result(uuid,uuid,text,boolean,boolean,text) to service_role;

create function public.read_sandbox_payment_order(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; r public.billing_sandbox_payment_results%rowtype;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id;
 if not found or auth.uid() is null or not public.has_organization_permission(o.organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 select * into r from public.billing_sandbox_payment_results where order_id=o.id;
 return jsonb_build_object('order',jsonb_build_object('id',o.id,'organizationId',o.organization_id,'planVersionId',o.plan_version_id,
 'environment','sandbox','shopId',o.shop_id,'returnUrl',o.return_url,'amountMinor',o.amount_minor,'currency',o.currency,'idempotencyKey',o.idempotency_key,'firstSentAt',o.first_sent_at,'providerPaymentId',r.payment_id),
 'result',case when r.order_id is null then null else to_jsonb(r) end);
end;$$;
revoke all on function public.read_sandbox_payment_order(uuid) from public,anon,authenticated;
grant execute on function public.read_sandbox_payment_order(uuid) to service_role;
-- Защитить старый путь отправки даже если вызывающий код забыл перечитать ID.
do $$declare d text; needle text:='measured:=clock_timestamp();'; begin
 d:=pg_get_functiondef('public.begin_sandbox_payment_send(uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'sandbox send marker missing'; end if;
 execute replace(d,needle,'if exists(select 1 from public.billing_sandbox_payment_results where order_id=o.id) then return jsonb_build_object(''can_send'',false,''reason'',''payment_already_identified''); end if; '||needle);
end;$$;
commit;
