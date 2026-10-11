begin;
create function public.schedule_tariff_support_end(p_version_id uuid,p_ends_at timestamptz,p_expected_count bigint,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.platform_tariff_publication_commands%rowtype; payload jsonb; result jsonb; preview jsonb;
begin
 perform public.require_platform_owner();
 if p_version_id is null or p_ends_at is null or not isfinite(p_ends_at) or p_command_id is null or p_expected_count is null then
 raise exception 'invalid support request' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','support_end','version',p_version_id,'ends_at',p_ends_at,'count',p_expected_count);
 select * into receipt from public.platform_tariff_publication_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then raise exception 'command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 lock table public.organization_subscriptions in share mode;
 perform 1 from public.billing_tariff_timeline where version_id=p_version_id for update;
 preview:=public.preview_tariff_support_end(p_version_id);
 if not (preview->>'can_schedule')::boolean then raise exception 'support cannot be scheduled' using errcode='55000'; end if;
 if (preview->>'assigned_organizations')::bigint<>p_expected_count then raise exception 'support preview changed' using errcode='40001'; end if;
 if p_ends_at<clock_timestamp()+interval '720 hours' then raise exception 'support notice requires 30 days' using errcode='22023'; end if;
 update public.billing_tariff_timeline set support_ends_at=p_ends_at,support_notice_at=p_ends_at-interval '720 hours' where version_id=p_version_id;
 result:=jsonb_build_object('version_id',p_version_id,'support_ends_at',p_ends_at,'support_notice_at',p_ends_at-interval '720 hours');
 insert into public.platform_tariff_publication_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,result);
 return result;
end; $$;
revoke all on function public.schedule_tariff_support_end(uuid,timestamptz,bigint,uuid) from public,anon,service_role;
grant execute on function public.schedule_tariff_support_end(uuid,timestamptz,bigint,uuid) to authenticated;
alter function public.get_organization_billing_overview(uuid) rename to get_organization_billing_overview_before_support;
revoke all on function public.get_organization_billing_overview_before_support(uuid) from public,anon,authenticated,service_role;
create function public.get_organization_billing_overview(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; notice jsonb;
begin
 result:=public.get_organization_billing_overview_before_support(p_organization_id);
 select jsonb_build_object('ends_at',t.support_ends_at,'ended',statement_timestamp()>=t.support_ends_at) into notice
 from public.organization_subscriptions s join public.billing_tariff_timeline t on t.version_id=s.plan_version_id
 where s.organization_id=p_organization_id and t.support_notice_at<=statement_timestamp();
 return result||jsonb_build_object('support_notice',notice);
end; $$;
revoke all on function public.get_organization_billing_overview(uuid) from public,anon,service_role;
grant execute on function public.get_organization_billing_overview(uuid) to authenticated;
commit;
