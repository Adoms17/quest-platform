begin;
-- Сверка уже начатого возврата не требует сохранения прав инициатора.
create function public.read_sandbox_refund_reconciliation(p_shop_id text,p_provider_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; o jsonb;
begin
 select f.* into r from public.billing_sandbox_refunds f join public.billing_sandbox_orders b on b.id=f.order_id
 where b.shop_id=p_shop_id and f.provider_refund_id=p_provider_id and f.first_sent_at is not null;
 if not found then return null; end if;
 o:=public.read_sandbox_reconciliation_order(p_shop_id,r.order_id,r.payment_id);
 return jsonb_build_object('refund',to_jsonb(r),'order',o);
end;$$;
create function public.list_sandbox_refund_reconciliation(p_shop_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x.provider_refund_id),'[]'::jsonb) from (
 select f.provider_refund_id from public.billing_sandbox_refunds f join public.billing_sandbox_orders o on o.id=f.order_id
 where o.shop_id=p_shop_id and f.state='pending' and f.provider_refund_id is not null
 order by f.updated_at,f.id limit 5) x;
$$;
create function public.record_verified_sandbox_refund(p_refund_id uuid,p_provider_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_sandbox_refunds%rowtype; target uuid;
begin
 select order_id into target from public.billing_sandbox_refunds where id=p_refund_id;
 perform 1 from public.billing_sandbox_orders where id=target for update;
 select * into r from public.billing_sandbox_refunds where id=p_refund_id for update;
 if not found or r.provider_refund_id is null or r.provider_refund_id is distinct from p_provider_id or r.first_sent_at is null
 or p_status is null or p_status not in ('pending','succeeded','canceled') then raise exception 'invalid verified refund' using errcode='22023'; end if;
 if r.state in ('succeeded','canceled') then
  if p_status<>'pending' and p_status<>r.state then update public.billing_sandbox_refunds set state='review',updated_at=clock_timestamp() where id=r.id returning * into r; end if;
 elsif r.state not in ('review','rejected') then
  update public.billing_sandbox_refunds set state=p_status,updated_at=clock_timestamp() where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end;$$;
create function public.touch_sandbox_refund_reconciliation(p_shop_id text,p_provider_id uuid) returns void
language sql security definer set search_path='' as $$
 update public.billing_sandbox_refunds f set updated_at=clock_timestamp()
 from public.billing_sandbox_orders o where o.id=f.order_id and o.shop_id=p_shop_id and f.provider_refund_id=p_provider_id and f.state='pending';
$$;
revoke all on function public.touch_sandbox_refund_reconciliation(text,uuid) from public,anon,authenticated;
grant execute on function public.touch_sandbox_refund_reconciliation(text,uuid) to service_role;
revoke all on function public.read_sandbox_refund_reconciliation(text,uuid),public.list_sandbox_refund_reconciliation(text),public.record_verified_sandbox_refund(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_sandbox_refund_reconciliation(text,uuid),public.list_sandbox_refund_reconciliation(text),public.record_verified_sandbox_refund(uuid,uuid,text) to service_role;
commit;
