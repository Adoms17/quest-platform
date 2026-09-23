begin;
create function platform_private.recurring_source_revision(s public.organization_subscriptions)
returns bigint language sql stable security definer set search_path='' as $$
 select case when s.status='active' then s.revision when s.status='expired' then (
  select e.source_revision from public.billing_expiration_events e
  where e.organization_id=s.organization_id and e.source_revision=s.revision-1
   and e.before_state->>'status'='active'
   and e.before_state->>'revision'=e.source_revision::text
   and e.after_state->>'revision'=(e.source_revision+1)::text
   and e.after_state=to_jsonb(s)
   and (e.before_state-'status'-'revision')=(e.after_state-'status'-'revision')
 ) end;
$$;
revoke all on function platform_private.recurring_source_revision(public.organization_subscriptions) from public,anon,authenticated,service_role;
do $$
declare definition text; item record;
begin
 for item in select * from (values
 ('platform_private.prepare_recurring_order(uuid,timestamp with time zone,bigint)','s.revision is distinct from p_expected_revision or s.status is distinct from ''active''','platform_private.recurring_source_revision(s) is distinct from p_expected_revision'),
 ('platform_private.review_recurring_order(uuid)','s.revision is distinct from r.expected_revision or s.status is distinct from ''active''','platform_private.recurring_source_revision(s) is distinct from r.expected_revision'),
 ('platform_private.authorize_recurring_send(uuid,uuid)','s.revision=r.expected_revision and s.status=''active''','platform_private.recurring_source_revision(s)=r.expected_revision'),
 ('public.prepare_due_sandbox_recurring(text)','select c.id,s.period_end,s.revision','select c.id,s.period_end,platform_private.recurring_source_revision(s) as revision'),
 ('public.prepare_due_sandbox_recurring(text)','s.status=''active''','platform_private.recurring_source_revision(s) is not null')
 ) as changes(signature,old_text,new_text)
 loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if position(item.old_text in definition)=0 then raise exception 'expiration marker missing: %',item.signature; end if;
  execute replace(definition,item.old_text,item.new_text);
 end loop;
end; $$;
commit;
