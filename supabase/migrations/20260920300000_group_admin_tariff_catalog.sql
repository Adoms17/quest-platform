begin;
create function public.read_platform_tariff_catalog_chronological(p_after jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; plan text; starts timestamptz; cursor_id uuid;
begin
 -- Сохраняем существующую проверку роли/MFA и аудит чтения каталога.
 perform public.read_platform_tariff_catalog_before_timeline(null,null);
 if p_after is not null then
 plan:=p_after->>'plan_key';starts:=(p_after->>'effective_at')::timestamptz;cursor_id:=(p_after->>'id')::uuid;
 if plan is null or starts is null or not isfinite(starts) or cursor_id is null then raise exception 'invalid catalog cursor' using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(item order by plan_key,effective_at,version_id),'[]'::jsonb) into rows from (
 select p.plan_key,t.effective_at,t.version_id,to_jsonb(p)||jsonb_build_object('effective_at',t.effective_at,'revoked_at',t.revoked_at,
 'timeline_number',platform_private.tariff_timeline_number(p.id),'timeline_state',platform_private.tariff_version_state(p.id,statement_timestamp())) item
 from public.billing_plan_versions p join public.billing_tariff_timeline t on t.version_id=p.id
 where p_after is null or (p.plan_key,t.effective_at,t.version_id)>(plan,starts,cursor_id)
 order by p.plan_key,t.effective_at,t.version_id limit 26) q;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
 'next_cursor',case when jsonb_array_length(rows)>25 then jsonb_build_object('plan_key',rows->24->'plan_key','effective_at',rows->24->'effective_at','id',rows->24->'id') else null end);
end; $$;
revoke all on function public.read_platform_tariff_catalog_chronological(jsonb) from public,anon,service_role;
grant execute on function public.read_platform_tariff_catalog_chronological(jsonb) to authenticated;
commit;
