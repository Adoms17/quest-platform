begin;
alter function public.get_sandbox_order_offer(uuid,uuid) rename to get_sandbox_order_offer_before_discount;
revoke all on function public.get_sandbox_order_offer_before_discount(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_sandbox_order_offer(p_organization_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c public.billing_discount_checkouts%rowtype; f jsonb; starts timestamptz; ends timestamptz;
begin
 -- Сначала существующая проверка пользователя, организации и billing.manage.
 result:=public.get_sandbox_order_offer_before_discount(p_organization_id,p_order_id);
 select d.* into c from public.billing_discount_checkouts d join public.billing_discount_payment_links l on l.checkout_id=d.id where l.payment_order_id=p_order_id;
 if not found then return result; end if;
 result:=result||jsonb_build_object('discount',jsonb_build_object(
 'base_amount_minor',(c.quote->>'base_amount_minor')::bigint,
 'discount_amount_minor',(c.quote->>'discount_amount_minor')::bigint,
 'discount_bps',(c.quote->>'discount_bps')::integer),
 'period_starts_on_confirmation',coalesce(c.quote->'trial_purchase'->>'transition'='replace_trial_on_payment',false));
 select d.result into f from public.billing_discount_fulfillments d where d.order_id=c.id;
 if f is not null then
 starts:=coalesce((f->>'period_start')::timestamptz,(result->>'period_start')::timestamptz);
 ends:=coalesce((f->>'period_end')::timestamptz,(result->>'period_end')::timestamptz);
 result:=result||jsonb_build_object('period_start',starts,'period_end',ends,
 'period_starts_on_confirmation',false,'period_scheduled',starts>statement_timestamp());
 end if;
 return result;
end; $$;
revoke all on function public.get_sandbox_order_offer(uuid,uuid) from public,anon;
grant execute on function public.get_sandbox_order_offer(uuid,uuid) to authenticated;
commit;
