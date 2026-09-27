begin;
create table public.billing_refund_receipt_requests (
 refund_id uuid primary key references public.billing_sandbox_refunds(id),
 body jsonb not null,
 created_at timestamptz not null default statement_timestamp()
);
create table public.billing_refund_receipt_status (
 refund_id uuid primary key references public.billing_refund_receipt_requests(refund_id),
 provider_refund_id uuid not null unique,
 status text not null check(status in ('unknown','pending','succeeded','canceled')),
 checked_at timestamptz not null default statement_timestamp()
);
alter table public.billing_refund_receipt_requests enable row level security;
alter table public.billing_refund_receipt_status enable row level security;
revoke all on public.billing_refund_receipt_requests,public.billing_refund_receipt_status from public,anon,authenticated,service_role;
create trigger refund_receipt_request_immutable before update or delete on public.billing_refund_receipt_requests for each row execute function public.guard_fiscal_storage();

create function public.prepare_refund_receipt_request(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.billing_sandbox_refunds%rowtype; o public.billing_sandbox_orders%rowtype; saved jsonb; body jsonb;
begin
 select * into f from public.billing_sandbox_refunds where id=p_refund_id for update;
 if not found then raise exception 'refund unavailable' using errcode='22023'; end if;
 select q.body into saved from public.billing_refund_receipt_requests q where q.refund_id=f.id;
 if found then return saved; end if;
 -- Legacy orders have no receipt snapshot: keep their existing sandbox flow.
 if not exists(select 1 from public.billing_receipt_snapshots where order_id=f.order_id)
  and not exists(select 1 from public.billing_recurring_receipt_snapshots where order_id=f.order_id) then return null; end if;
 select * into o from public.billing_sandbox_orders where id=f.order_id;
 if f.amount_minor<>o.amount_minor then raise exception 'partial refund receipt required' using errcode='55000'; end if;
 if f.first_sent_at is null or f.state<>'sending' or f.provider_refund_id is not null then
  raise exception 'refund send not prepared' using errcode='55000'; end if;
 if not exists(select 1 from public.billing_receipt_payment_requests where order_id=o.id)
  and not exists(select 1 from public.billing_recurring_receipt_requests where order_id=o.id) then
  raise exception 'original receipt request unavailable' using errcode='55000'; end if;
 body:=jsonb_build_object('payment_id',f.payment_id,'amount',jsonb_build_object('value',(f.amount_minor/100)::text||'.'||lpad((f.amount_minor%100)::text,2,'0'),'currency',o.currency));
 insert into public.billing_refund_receipt_requests(refund_id,body) values(f.id,body);
 return body;
end; $$;
revoke all on function public.prepare_refund_receipt_request(uuid) from public,anon,authenticated;
grant execute on function public.prepare_refund_receipt_request(uuid) to service_role;

create function public.record_refund_receipt_status(p_refund_id uuid,p_provider_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare old public.billing_refund_receipt_status%rowtype;
begin
 perform 1 from public.billing_refund_receipt_requests where refund_id=p_refund_id for update;
 if not found then return; end if;
 if p_provider_id is null or p_status is null or p_status not in ('unknown','pending','succeeded','canceled') then
  raise exception 'invalid receipt result' using errcode='22023'; end if;
 select * into old from public.billing_refund_receipt_status where refund_id=p_refund_id;
 if found then
  if old.provider_refund_id<>p_provider_id then raise exception 'receipt refund conflict' using errcode='22023'; end if;
  if old.status in ('succeeded','canceled') and p_status<>old.status then return; end if;
  if old.status='pending' and p_status='unknown' then return; end if;
 end if;
 insert into public.billing_refund_receipt_status(refund_id,provider_refund_id,status) values(p_refund_id,p_provider_id,p_status)
 on conflict(refund_id) do update set status=excluded.status,checked_at=statement_timestamp();
end; $$;
revoke all on function public.record_refund_receipt_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_refund_receipt_status(uuid,uuid,text) to service_role;
commit;
