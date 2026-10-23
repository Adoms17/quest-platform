begin;
create table public.purchase_document_versions (
 id text primary key check (id ~ '^[a-z0-9-]{1,80}$'),
 kind text not null check (kind in ('agreement','payment_terms')),
 status text not null default 'draft' check (status in ('draft','published')),
 body text not null check (length(btrim(body)) > 0),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 published_at timestamptz,
 effective_at timestamptz,
 check ((status='draft' and published_at is null and effective_at is null)
  or (status='published' and published_at is not null and effective_at is not null
   and isfinite(published_at) and isfinite(effective_at) and published_at<=effective_at))
);
create unique index purchase_document_start on public.purchase_document_versions(kind,effective_at) where status='published';
alter table public.purchase_document_versions enable row level security;
revoke all on public.purchase_document_versions from public,anon,authenticated,service_role;
grant select on public.purchase_document_versions to anon,authenticated;
create policy published_purchase_documents on public.purchase_document_versions for select to anon,authenticated
 using(status='published' and effective_at<=statement_timestamp());

create function public.guard_purchase_document_version() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if TG_OP in ('UPDATE','DELETE') and old.status='published' then
  raise exception using errcode='55000',message='published purchase document is immutable';
 end if;
 if TG_OP='DELETE' then return old; end if;
 new.sha256:=encode(sha256(convert_to(new.body,'UTF8')),'hex');
 if new.status='published' then
  new.published_at:=statement_timestamp();
  if new.effective_at is null then new.effective_at:=new.published_at; end if;
 end if;
 return new;
end; $$;
revoke all on function public.guard_purchase_document_version() from public,anon,authenticated,service_role;
create trigger guard_purchase_document_version before insert or update or delete on public.purchase_document_versions
 for each row execute function public.guard_purchase_document_version();
commit;
