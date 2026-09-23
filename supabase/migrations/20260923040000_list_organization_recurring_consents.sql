begin;
create function public.list_sandbox_recurring_consents(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 -- Чтение и отзыв доступны даже после исключения из sandbox-области.
 select coalesce(jsonb_agg(jsonb_build_object(
 'consent_id',c.id,'order_id',c.order_id,'created_at',c.created_at,
 'state',case when v.consent_id is not null then 'revoked' when m.consent_id is not null then 'saved' else 'pending' end
 ) order by c.created_at desc,c.id),'[]'::jsonb) into result
 from public.billing_recurring_consents c
 left join public.billing_recurring_revocations v on v.consent_id=c.id
 left join public.billing_recurring_methods m on m.consent_id=c.id
 where c.organization_id=p_organization_id;
 return result;
end; $$;
revoke all on function public.list_sandbox_recurring_consents(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_sandbox_recurring_consents(uuid) to authenticated;
commit;
