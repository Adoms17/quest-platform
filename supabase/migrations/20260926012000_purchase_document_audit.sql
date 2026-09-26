begin;
create table public.purchase_document_audit (
 id bigint generated always as identity primary key,
 document_id text not null,
 actor_id uuid,
 action text not null check(action in ('draft_created','draft_updated','published','draft_deleted')),
 before_sha256 text,
 after_sha256 text,
 effective_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.purchase_document_audit enable row level security;
revoke all on public.purchase_document_audit from public,anon,authenticated,service_role;
revoke all on sequence public.purchase_document_audit_id_seq from public,anon,authenticated,service_role;
create function platform_private.audit_purchase_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new is not distinct from old then return new; end if;
 insert into public.purchase_document_audit(document_id,actor_id,action,before_sha256,after_sha256,effective_at)
 values(case when TG_OP='DELETE' then old.id else new.id end,auth.uid(),
 case when TG_OP='DELETE' then 'draft_deleted' when new.status='published' then 'published'
 when TG_OP='INSERT' then 'draft_created' else 'draft_updated' end,
 case when TG_OP='INSERT' then null else old.sha256 end,
 case when TG_OP='DELETE' then null else new.sha256 end,
 case when TG_OP='DELETE' then old.effective_at else new.effective_at end);
 if TG_OP='DELETE' then return old; end if;
 return new;
end; $$;
create function platform_private.guard_purchase_document_audit() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'purchase document audit is immutable' using errcode='55000'; end; $$;
revoke all on function platform_private.audit_purchase_document(),platform_private.guard_purchase_document_audit() from public,anon,authenticated,service_role;
create trigger purchase_document_audit after insert or update or delete on public.purchase_document_versions
 for each row execute function platform_private.audit_purchase_document();
create trigger guard_purchase_document_audit before update or delete on public.purchase_document_audit
 for each row execute function platform_private.guard_purchase_document_audit();
commit;
