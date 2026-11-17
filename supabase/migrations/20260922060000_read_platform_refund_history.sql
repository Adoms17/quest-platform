begin;
create function public.read_platform_order_refunds(p_organization_id uuid,p_order_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; cursor_time timestamptz; result jsonb;
begin
 assignment:=public.require_platform_permission('billing.payment.read',p_organization_id);
 if not exists(select 1 from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id) then
  raise exception 'order unavailable' using errcode='42501';
 end if;
 if p_after is not null then
  select created_at into cursor_time from public.billing_sandbox_refunds where id=p_after and order_id=p_order_id;
  if not found then raise exception 'invalid refund cursor' using errcode='22023'; end if;
 end if;
 with candidates as (
  select f.id,f.created_at,f.amount_minor,f.state,c.reason_code,
   (c.refund_id is not null and f.state in ('reserved','sending','pending')) as can_resume
  from public.billing_sandbox_refunds f left join public.platform_refund_commands c on c.refund_id=f.id
  where f.order_id=p_order_id and (p_after is null or (f.created_at,f.id)<(cursor_time,p_after))
  order by f.created_at desc,f.id desc limit 26
 ), numbered as(select *,row_number() over(order by created_at desc,id desc) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(r)-'n' order by created_at desc,id desc) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by created_at desc,id desc))[25] else null end)
 into result from numbered r;
 insert into public.platform_payment_read_events(actor_id,assignment_id,organization_id) values(auth.uid(),assignment,p_organization_id);
 return result;
end;$$;
revoke all on function public.read_platform_order_refunds(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_order_refunds(uuid,uuid,uuid) to authenticated;
commit;
