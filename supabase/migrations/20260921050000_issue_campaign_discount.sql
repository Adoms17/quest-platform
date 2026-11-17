begin;
alter table public.platform_role_permissions drop constraint platform_role_permissions_permission_key_check;
alter table public.platform_role_permissions add constraint platform_role_permissions_permission_key_check check(permission_key in ('organization.summary.read','billing.catalog.read','billing.discount.read','billing.campaign.draft','billing.campaign.issue'));
insert into public.platform_role_permissions values ('owner','billing.campaign.issue'),('sales','billing.campaign.issue');
alter table public.billing_discount_codes add column campaign_id uuid unique references public.platform_discount_campaigns(id);
create function public.issue_platform_campaign_discount(p_organization_id uuid,p_campaign_id uuid,p_expected_revision integer,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.platform_discount_campaigns%rowtype; existing public.billing_discount_codes%rowtype; raw_code text;
begin
 perform pg_advisory_xact_lock(18092026,1);
 perform public.require_platform_permission('billing.campaign.issue',p_organization_id);
 if p_campaign_id is null or p_expected_revision is null or p_command_id is null then raise exception 'invalid campaign issue' using errcode='22023'; end if;
 select * into campaign from public.platform_discount_campaigns where id=p_campaign_id and organization_id=p_organization_id for update;
 if not found then raise exception 'campaign unavailable' using errcode='22023'; end if;
 if campaign.state<>'approved' then raise exception 'campaign not approved' using errcode='55000'; end if;
 if campaign.revision<>p_expected_revision then raise exception 'campaign revision conflict' using errcode='40001'; end if;
 select * into existing from public.billing_discount_codes where issuer_id=auth.uid() and issue_command_id=p_command_id;
 if found and existing.campaign_id is distinct from campaign.id then raise exception 'discount command conflict' using errcode='22023'; end if;
 select * into existing from public.billing_discount_codes where campaign_id=campaign.id;
 if found then return jsonb_build_object('discount_id',existing.id,'already_issued',true,'code',null); end if;
 if campaign.activate_before<=clock_timestamp() then raise exception 'discount activation deadline expired' using errcode='22023'; end if;
 raw_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
 insert into public.billing_discount_codes(organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id,campaign_id)
 values(campaign.organization_id,campaign.plan_key,encode(extensions.digest(raw_code,'sha256'),'hex'),campaign.discount_bps,campaign.eligible_periods,campaign.period_months,campaign.activate_before,auth.uid(),p_command_id,campaign.id)
 returning * into existing;
 return jsonb_build_object('discount_id',existing.id,'already_issued',false,'code',raw_code);
end; $$;
revoke all on function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_platform_campaign_discount(uuid,uuid,integer,uuid) to authenticated;
commit;
