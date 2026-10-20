begin;
create function public.save_purchase_document_draft(p_id text,p_kind text,p_body text,p_expected_sha256 text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc public.purchase_document_versions;
begin
 perform public.require_platform_owner();
 if p_body is null or octet_length(p_body)>1048576 then raise exception 'invalid document body' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase-document:'||coalesce(p_id,''),0));
 select * into doc from public.purchase_document_versions where id=p_id for update;
 if found then
  if doc.status<>'draft' then raise exception 'published purchase document is immutable' using errcode='55000'; end if;
  if doc.kind=p_kind and doc.body=p_body then return to_jsonb(doc); end if;
  if p_expected_sha256 is null or doc.sha256<>p_expected_sha256 or doc.kind<>p_kind then
   raise exception 'document draft changed' using errcode='40001'; end if;
  update public.purchase_document_versions set body=p_body where id=p_id returning * into doc;
 else
  if p_expected_sha256 is not null then raise exception 'document draft missing' using errcode='40001'; end if;
  insert into public.purchase_document_versions(id,kind,body) values(p_id,p_kind,p_body) returning * into doc;
 end if;
 return to_jsonb(doc);
end; $$;
create function public.publish_purchase_document(p_id text,p_expected_sha256 text,p_effective_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc public.purchase_document_versions;
begin
 perform public.require_platform_owner();
 select * into doc from public.purchase_document_versions where id=p_id for update;
 if not found or p_expected_sha256 is null or doc.sha256<>p_expected_sha256 then
  raise exception 'document draft changed' using errcode='40001'; end if;
 if doc.status='published' and doc.effective_at=p_effective_at then return to_jsonb(doc); end if;
 if doc.status<>'draft' then raise exception 'published purchase document is immutable' using errcode='55000'; end if;
 if p_effective_at is null or not isfinite(p_effective_at) or p_effective_at<clock_timestamp() then
  raise exception 'future effective date required' using errcode='22023'; end if;
 update public.purchase_document_versions set status='published',effective_at=p_effective_at where id=p_id returning * into doc;
 return to_jsonb(doc);
end; $$;
revoke all on function public.save_purchase_document_draft(text,text,text,text),public.publish_purchase_document(text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_purchase_document_draft(text,text,text,text),public.publish_purchase_document(text,text,timestamptz) to authenticated;
commit;
