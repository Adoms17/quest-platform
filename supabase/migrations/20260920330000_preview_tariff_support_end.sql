begin;
create function public.preview_tariff_support_end(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare state text; timeline public.billing_tariff_timeline%rowtype; affected bigint;
begin
 perform public.read_platform_tariff_catalog_before_timeline(null,p_version_id);
 if not exists(select 1 from public.platform_access_assignments where user_id=auth.uid()
 and role_key='owner' and scope_kind='platform' and revoked_at is null
 and valid_from<=clock_timestamp() and expires_at is null) then
 raise exception 'platform owner required' using errcode='42501'; end if;
 select * into timeline from public.billing_tariff_timeline where version_id=p_version_id;
 if not found then raise exception 'tariff not found' using errcode='22023'; end if;
 state:=platform_private.tariff_version_state(p_version_id,statement_timestamp());
 select count(*) into affected from public.organization_subscriptions where plan_version_id=p_version_id;
 return jsonb_build_object('version_id',p_version_id,'state',state,
 'can_schedule',state='superseded' and timeline.support_ends_at is null,
 'support_ends_at',timeline.support_ends_at,'minimum_support_ends_at',statement_timestamp()+interval '720 hours',
 'assigned_organizations',affected,'notice_days',30);
end; $$;
revoke all on function public.preview_tariff_support_end(uuid) from public,anon,service_role;
grant execute on function public.preview_tariff_support_end(uuid) to authenticated;
commit;
