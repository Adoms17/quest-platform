begin;
create function public.read_purchase_document(p_kind text,p_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(d) from public.purchase_document_versions d
 where d.kind=p_kind and d.id=p_id and d.status='published' and d.effective_at<=statement_timestamp();
$$;
create function public.list_current_purchase_documents() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(d) order by d.kind),'[]'::jsonb) from (
 select distinct on (kind) id,kind,sha256,effective_at,published_at
 from public.purchase_document_versions where status='published' and effective_at<=statement_timestamp()
 order by kind,effective_at desc
 ) d;
$$;
create function public.read_platform_purchase_document(p_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 return (select to_jsonb(d) from public.purchase_document_versions d where id=p_id);
end; $$;
create function public.read_platform_purchase_document_audit(p_id text,p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_owner();
 if p_before is not null and p_before<=0 then raise exception 'invalid audit cursor' using errcode='22023'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) from (
 select * from public.purchase_document_audit where document_id=p_id and (p_before is null or id<p_before)
 order by id desc limit 50) e);
end; $$;
revoke all on function public.read_purchase_document(text,text),public.list_current_purchase_documents(),public.read_platform_purchase_document(text),public.read_platform_purchase_document_audit(text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.read_purchase_document(text,text),public.list_current_purchase_documents() to anon,authenticated;
grant execute on function public.read_platform_purchase_document(text),public.read_platform_purchase_document_audit(text,bigint) to authenticated;
commit;
