begin;
create or replace function public.read_platform_organization_payments(p_organization_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment uuid; cursor_time timestamptz; result jsonb;
begin
 assignment:=public.require_platform_permission('billing.payment.read',p_organization_id);
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization unavailable' using errcode='22023'; end if;
 if p_after is not null then
  select created_at into cursor_time from public.billing_sandbox_orders where id=p_after and organization_id=p_organization_id;
  if not found then raise exception 'invalid payment cursor' using errcode='22023'; end if;
 end if;
 with candidates as (
 select o.id,o.created_at,o.amount_minor,o.currency,o.state order_state,o.period_start,o.period_end,o.plan_version_id
 from public.billing_sandbox_orders o where o.organization_id=p_organization_id
 and (p_after is null or (o.created_at,o.id)<(cursor_time,p_after))
 order by o.created_at desc,o.id desc limit 26
 ), numbered as (select *,row_number() over(order by created_at desc,id desc) n from candidates),
 projected as (
 select n.*,p.display_name plan_name,p.plan_key,platform_private.tariff_timeline_number(p.id) plan_number,
 coalesce((coalesce(c.quote,rc.quote)->>'base_amount_minor')::bigint,n.amount_minor) base_amount_minor,
 coalesce((coalesce(c.quote,rc.quote)->>'discount_amount_minor')::bigint,0) discount_amount_minor,
 coalesce((coalesce(c.quote,rc.quote)->>'discount_bps')::integer,0) discount_bps,
 r.updated_at payment_checked_at,r.payment_id,coalesce(r.status,'not_created') payment_status,
 coalesce(r.paid,false) paid,coalesce(r.requires_review,false) payment_requires_review,
 'sandbox'::text environment,coalesce(f.state,'none') fulfillment_state,
 case when f.reason in ('future_period','payment_conflict','sandbox_scope_disabled','discount_reconciliation_required','sandbox_payment_unverified','fully_refunded_trial_duplicate') then f.reason
 when f.reason is not null then 'other' else null end fulfillment_reason,
 f.checked_at fulfillment_checked_at,refunds.*
 from numbered n left join public.billing_sandbox_payment_results r on r.order_id=n.id
 join public.billing_plan_versions p on p.id=n.plan_version_id
 left join public.billing_discount_checkouts c on c.id=n.id
 left join public.billing_recurring_orders rc on rc.id=n.id
 left join public.billing_sandbox_fulfillments f on f.order_id=n.id
 cross join lateral (
 select coalesce(sum(amount_minor) filter(where state='succeeded'),0) refunded_minor,
 coalesce(sum(amount_minor) filter(where state in ('reserved','sending','pending')),0) refund_pending_minor,
 coalesce(sum(amount_minor) filter(where state='review'),0) refund_review_minor,
 coalesce(bool_or(state='review'),false) refund_requires_review
 from public.billing_sandbox_refunds where order_id=n.id
 ) refunds
 )
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(p)-'n' order by created_at desc,id desc) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by created_at desc,id desc))[25] else null end)
 into result from projected p;
 insert into public.platform_payment_read_events(actor_id,assignment_id,organization_id) values(auth.uid(),assignment,p_organization_id);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.payment.read','sqlstate','42501','occurred_at',clock_timestamp());
 raise;
end; $$;
revoke all on function public.read_platform_organization_payments(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_organization_payments(uuid,uuid) to authenticated;
commit;