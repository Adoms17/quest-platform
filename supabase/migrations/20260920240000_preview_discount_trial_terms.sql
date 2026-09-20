begin;
alter function public.preview_sandbox_discount_offer(uuid,uuid,text) rename to preview_sandbox_discount_offer_before_trial;
revoke all on function public.preview_sandbox_discount_offer_before_trial(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.preview_sandbox_discount_offer(p_organization_id uuid,p_offer_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; terms jsonb;
begin
 result:=public.preview_sandbox_discount_offer_before_trial(p_organization_id,p_offer_id,p_code);
 if not (result->>'ok')::boolean then return result; end if;
 begin
 terms:=platform_private.capture_trial_checkout_terms(p_organization_id,p_offer_id);
 exception when sqlstate '22023' then return jsonb_build_object('ok',false,'reason','offer_unavailable');
 end;
 return result||terms;
end; $$;
revoke all on function public.preview_sandbox_discount_offer(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.preview_sandbox_discount_offer(uuid,uuid,text) to authenticated;
-- В сравнении участвует весь снимок trial, включая поколение.
create or replace function platform_private.discount_quote_review_fields(p_quote jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(k,p_quote->k),'{}'::jsonb)
 ||jsonb_build_object('trial_purchase',coalesce(p_quote->'trial_purchase','{}'::jsonb))
 from unnest(array['organization_id','offer_id','plan_version_id','discount_id',
 'base_amount_minor','discount_amount_minor','amount_minor','discount_bps','requires_payment',
 'currency','environment','period_months','period_start','period_end','valid_until','remaining_periods']) k;
$$;
commit;
