begin;
create function public.list_platform_purchase_documents(p_kind text, p_after jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; cursor_date timestamptz; cursor_id text;
begin
 perform public.require_platform_owner();
 if p_kind is null or p_kind not in ('agreement','payment_terms') then raise exception 'invalid document kind' using errcode='22023'; end if;
 if p_after is not null then
  if jsonb_typeof(p_after) <> 'object' or not (p_after ? 'id' and p_after ? 'effective_at') or coalesce(p_after->>'id','')='' then
   raise exception 'invalid document cursor' using errcode='22023';
  end if;
  cursor_id := p_after->>'id';
  cursor_date := coalesce((p_after->>'effective_at')::timestamptz,'infinity'::timestamptz);
 end if;
 with current_version as (
  select id from public.purchase_document_versions where kind=p_kind and status='published' and effective_at<=statement_timestamp() order by effective_at desc limit 1
 ), page as (
  select d.id,d.kind,d.sha256,d.effective_at,d.published_at,
   case when d.status='draft' then 'draft' when d.effective_at>statement_timestamp() then 'scheduled'
    when d.id=(select id from current_version) then 'current' else 'superseded' end as display_status
  from public.purchase_document_versions d where kind=p_kind
   and (p_after is null or (coalesce(d.effective_at,'infinity'::timestamptz),d.id)<(cursor_date,cursor_id))
  order by coalesce(d.effective_at,'infinity'::timestamptz) desc,d.id desc limit 51
 ), visible as (select * from page order by coalesce(effective_at,'infinity'::timestamptz) desc,id desc limit 50)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by coalesce(v.effective_at,'infinity'::timestamptz) desc,v.id desc) from visible v),'[]'::jsonb),
 'next_cursor',case when (select count(*) from page)>50 then (select jsonb_build_object('id',id,'effective_at',effective_at) from visible order by coalesce(effective_at,'infinity'::timestamptz),id limit 1) else null end,
 'measured_at',statement_timestamp()) into result;
 return result;
end; $$;
revoke all on function public.list_platform_purchase_documents(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_platform_purchase_documents(text,jsonb) to authenticated;
commit;
