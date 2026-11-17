begin;
-- Internal RPCs only. No browser can submit a provider body or a fiscal result.
create table public.billing_receipt_payment_requests (
 order_id uuid primary key references public.billing_receipt_snapshots(order_id),
 idempotency_key uuid not null unique,
 body jsonb not null check(jsonb_typeof(body)='object'),
 body_sha256 text not null,
 created_at timestamptz not null default statement_timestamp()
);
create table public.billing_receipt_payment_status (
 order_id uuid primary key references public.billing_receipt_payment_requests(order_id),
 payment_id uuid not null unique,
 status text not null check(status in ('unknown','pending','succeeded','canceled')),
 checked_at timestamptz not null default statement_timestamp()
);
alter table public.billing_receipt_payment_requests enable row level security;
alter table public.billing_receipt_payment_status enable row level security;
revoke all on public.billing_receipt_payment_requests,public.billing_receipt_payment_status from public,anon,authenticated,service_role;
create trigger receipt_payment_request_immutable before update or delete on public.billing_receipt_payment_requests for each row execute function public.guard_fiscal_storage();

create function public.read_sandbox_receipt_snapshot_internal(p_order_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select to_jsonb(s) from public.billing_receipt_snapshots s where order_id=p_order_id;
$$;
revoke all on function public.read_sandbox_receipt_snapshot_internal(uuid) from public,anon,authenticated;
grant execute on function public.read_sandbox_receipt_snapshot_internal(uuid) to service_role;

create function public.save_sandbox_receipt_request(p_order_id uuid,p_key uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.billing_receipt_snapshots%rowtype;
 r public.billing_receipt_payment_requests%rowtype; expected jsonb; value text;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not found then raise exception 'receipt order unavailable' using errcode='22023'; end if;
 select * into s from public.billing_receipt_snapshots where order_id=o.id;
 if not found then raise exception 'receipt snapshot unavailable' using errcode='55000'; end if;
 select * into r from public.billing_receipt_payment_requests where order_id=o.id;
 if found then
  if r.idempotency_key is distinct from p_key or r.body is distinct from p_body then
   raise exception 'receipt request conflict' using errcode='22023'; end if;
  return jsonb_build_object('body',r.body,'key',r.idempotency_key,'sha256',r.body_sha256);
 end if;
 if o.first_sent_at is null or o.state not in ('sending','review') or o.idempotency_key is distinct from p_key then
  raise exception 'receipt send not prepared' using errcode='55000'; end if;
 value:=(s.amount_minor/100)::text||'.'||lpad((s.amount_minor%100)::text,2,'0');
 expected:=jsonb_build_object('customer',jsonb_build_object('email',s.email),'items',jsonb_build_array(jsonb_build_object(
  'description',s.description,'quantity','1.000','amount',jsonb_build_object('value',value,'currency',s.currency),
  'vat_code',s.vat_code,'payment_subject',s.payment_subject,'payment_mode',s.payment_mode)));
 if p_body is null or p_body->'receipt' is distinct from expected
  or p_body->'amount' is distinct from jsonb_build_object('value',value,'currency',s.currency)
  or p_body->'capture' is distinct from 'true'::jsonb
  or p_body#>>'{metadata,order_id}' is distinct from o.id::text
  or p_body#>>'{metadata,organization_id}' is distinct from o.organization_id::text
  or p_body#>>'{metadata,plan_version_id}' is distinct from o.plan_version_id::text
  or p_body#>>'{metadata,environment}' is distinct from 'sandbox' then
  raise exception 'receipt request mismatch' using errcode='22023'; end if;
 insert into public.billing_receipt_payment_requests(order_id,idempotency_key,body,body_sha256)
 values(o.id,p_key,p_body,encode(extensions.digest(convert_to(p_body::text,'UTF8'),'sha256'),'hex')) returning * into r;
 return jsonb_build_object('body',r.body,'key',r.idempotency_key,'sha256',r.body_sha256);
end; $$;
revoke all on function public.save_sandbox_receipt_request(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_sandbox_receipt_request(uuid,uuid,jsonb) to service_role;

create function public.record_sandbox_receipt_status(p_order_id uuid,p_payment_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.billing_receipt_payment_status%rowtype;
begin
 perform 1 from public.billing_receipt_payment_requests where order_id=p_order_id for update;
 if not found then raise exception 'receipt request unavailable' using errcode='55000'; end if;
 if p_payment_id is null or p_status is null or p_status not in ('unknown','pending','succeeded','canceled') then
  raise exception 'invalid receipt result' using errcode='22023'; end if;
 select * into r from public.billing_receipt_payment_status where order_id=p_order_id;
 if found then
  if r.payment_id<>p_payment_id then raise exception 'receipt payment conflict' using errcode='22023'; end if;
  if r.status in ('succeeded','canceled') and p_status<>r.status then return; end if;
  if r.status='pending' and p_status='unknown' then return; end if;
 end if;
 insert into public.billing_receipt_payment_status(order_id,payment_id,status) values(p_order_id,p_payment_id,p_status)
 on conflict(order_id) do update set status=excluded.status,checked_at=statement_timestamp();
end; $$;
revoke all on function public.record_sandbox_receipt_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_sandbox_receipt_status(uuid,uuid,text) to service_role;

create function public.read_sandbox_receipt_status(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; result jsonb;
begin
 select * into o from public.billing_sandbox_orders where id=p_order_id;
 if auth.uid() is null or o.id is null or o.actor_id<>auth.uid()
  or public.has_organization_permission(o.organization_id,'billing.manage') is not true then
  raise exception 'receipt access denied' using errcode='42501'; end if;
 select jsonb_build_object('status',s.status,'checkedAt',s.checked_at) into result
 from public.billing_receipt_payment_status s where order_id=o.id;
 return coalesce(result,jsonb_build_object('status',case when exists(select 1 from public.billing_receipt_payment_requests where order_id=o.id) then 'unknown' else 'not_sent' end));
end; $$;
revoke all on function public.read_sandbox_receipt_status(uuid) from public,anon,service_role;
grant execute on function public.read_sandbox_receipt_status(uuid) to authenticated;
commit;
