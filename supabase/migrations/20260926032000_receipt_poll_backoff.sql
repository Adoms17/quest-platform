begin;
create table public.billing_receipt_poll_schedule (
 kind text not null check(kind in ('payment','renewal','refund')),
 operation_id uuid not null,
 consecutive_failures integer not null default 0 check(consecutive_failures between 0 and 16),
 checked_at timestamptz not null,
 next_check_at timestamptz not null,
 primary key(kind,operation_id)
);
alter table public.billing_receipt_poll_schedule enable row level security;
revoke all on public.billing_receipt_poll_schedule from public,anon,authenticated,service_role;
create function public.record_receipt_poll(p_kind text,p_operation_id uuid,p_succeeded boolean) returns void
language plpgsql security definer set search_path='' as $$
declare valid boolean;
begin
 if p_kind is null or p_operation_id is null or p_succeeded is null then raise exception 'invalid receipt poll' using errcode='22023'; end if;
 case p_kind
 when 'payment' then select exists(select 1 from public.billing_receipt_payment_requests where order_id=p_operation_id) into valid;
 when 'renewal' then select exists(select 1 from public.billing_recurring_receipt_requests where order_id=p_operation_id) into valid;
 when 'refund' then select exists(select 1 from public.billing_refund_receipt_requests where refund_id=p_operation_id) into valid;
 else raise exception 'invalid receipt poll' using errcode='22023'; end case;
 if not valid then raise exception 'receipt request unavailable' using errcode='22023'; end if;
 insert into public.billing_receipt_poll_schedule(kind,operation_id,consecutive_failures,checked_at,next_check_at)
 values(p_kind,p_operation_id,case when p_succeeded then 0 else 1 end,clock_timestamp(),clock_timestamp()+make_interval(secs=>case when p_succeeded then 300 else 60 end))
 on conflict(kind,operation_id) do update set
 consecutive_failures=case when p_succeeded then 0 else least(public.billing_receipt_poll_schedule.consecutive_failures+1,16) end,
 checked_at=clock_timestamp(),
 next_check_at=clock_timestamp()+make_interval(secs=>case when p_succeeded then 300 else least(3600,60*power(2,least(public.billing_receipt_poll_schedule.consecutive_failures,6)))::integer end);
end; $$;
revoke all on function public.record_receipt_poll(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_receipt_poll(text,uuid,boolean) to service_role;
-- Extend all three queues without changing their public response contracts.
do $$
declare spec record; definition text; marker text:='where (p_shop_id is null';
begin
 for spec in select * from (values
 ('public.list_pending_sandbox_receipts(integer,text)','payment','o.id'),
 ('public.list_pending_recurring_receipts(integer,text)','renewal','r.order_id'),
 ('public.list_pending_refund_receipts(integer,text)','refund','f.id')) v(signature,kind,identity) loop
 definition:=pg_get_functiondef(spec.signature::regprocedure);
 if position(marker in definition)=0 then raise exception 'receipt poll marker missing'; end if;
 execute replace(definition,marker,format('where not exists(select 1 from public.billing_receipt_poll_schedule q where q.kind=%L and q.operation_id=%s and q.next_check_at>statement_timestamp()) and (p_shop_id is null',spec.kind,spec.identity));
 end loop;
end; $$;
commit;
