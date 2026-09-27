begin;
create function public.list_sandbox_fiscal_policies(p_shop_id text,p_before timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_owner();
 if p_shop_id is null or p_shop_id !~ '^[0-9]+$' or (p_before is not null and not isfinite(p_before)) then
  raise exception 'invalid fiscal policy query' using errcode='22023'; end if;
 with current_policy as (
  select id from public.billing_fiscal_policies where environment='sandbox' and shop_id=p_shop_id
   and effective_at<=statement_timestamp() order by effective_at desc limit 1
 ), page as (
  select id,shop_id,effective_at,vat_code,payment_subject,payment_mode,
   case when effective_at>statement_timestamp() then 'scheduled'
    when id=(select id from current_policy) then 'current' else 'superseded' end as display_status
  from public.billing_fiscal_policies where environment='sandbox' and shop_id=p_shop_id
   and (p_before is null or effective_at<p_before) order by effective_at desc limit 51
 ), visible as (select * from page order by effective_at desc limit 50)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by effective_at desc) from visible v),'[]'::jsonb),
  'next_cursor',case when (select count(*) from page)>50 then (select min(effective_at) from visible) else null end,
  'measured_at',statement_timestamp()) into result;
 return result;
end; $$;
revoke all on function public.list_sandbox_fiscal_policies(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.list_sandbox_fiscal_policies(text,timestamptz) to authenticated;
commit;
