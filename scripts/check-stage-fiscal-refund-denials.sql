begin transaction read only;
set local statement_timeout='20s';
do $$ declare q public.subscription_refund_requests%rowtype; begin
 select * into strict q from public.subscription_refund_requests where order_id='903c6786-cc88-4218-a58e-4e889ee30e8c';
 if not exists(select 1 from public.platform_access_assignments where user_id=q.actor_id and role_key='owner' and revoked_at is null and scope_kind='platform' and valid_from<=clock_timestamp() and expires_at is null) then raise exception 'fixture owner unavailable'; end if;
 perform set_config('test.actor',q.actor_id::text,true);
 perform set_config('test.request',q.id::text,true);
end; $$;
set local role service_role;
do $$
declare c record; stamp bigint:=floor(extract(epoch from clock_timestamp()))::bigint; denied boolean; results jsonb:='[]';
 prior_sub text:=current_setting('request.jwt.claim.sub',true); prior_claims text:=current_setting('request.jwt.claims',true);
begin
 for c in select * from (values
 ('stale_mfa',600,3600,'e129101e-0878-5585-d3e8-207d76ef15c1','903c6786-cc88-4218-a58e-4e889ee30e8c',current_setting('test.request'),'invalid fiscal refund preparation context'),
 ('expired_identity',0,-60,'e129101e-0878-5585-d3e8-207d76ef15c1','903c6786-cc88-4218-a58e-4e889ee30e8c',current_setting('test.request'),'invalid fiscal refund preparation context'),
 ('foreign_order',0,3600,'e129101e-0878-5585-d3e8-207d76ef15c1','80fac987-e40e-4521-8f94-ffbc3193ca32',current_setting('test.request'),'fiscal refund scope denied'),
 ('foreign_organization',0,3600,'e2790c93-7bfa-7992-f6f0-74f1cf1c79e5','903c6786-cc88-4218-a58e-4e889ee30e8c',current_setting('test.request'),'fiscal refund scope denied'),
 ('foreign_request',0,3600,'e129101e-0878-5585-d3e8-207d76ef15c1','903c6786-cc88-4218-a58e-4e889ee30e8c','00000000-0000-4000-8000-000000000001','fiscal refund scope denied')
 ) as cases(name,age,expiry,org,ord,req,expected) loop
 denied:=false;
 begin
 perform public.prepare_linked_fiscal_refund_from_gateway(current_setting('test.actor')::uuid,stamp-c.age,stamp+c.expiry,'1467641',c.org::uuid,c.ord::uuid,c.req::uuid);
 exception when insufficient_privilege then
 if sqlerrm<>c.expected then raise exception 'unexpected denial for %',c.name; end if;
 denied:=true;
 end;
 if not denied then raise exception 'unexpected permission for %',c.name; end if;
 if coalesce(current_setting('request.jwt.claim.sub',true),'') is distinct from coalesce(prior_sub,'') or coalesce(current_setting('request.jwt.claims',true),'') is distinct from coalesce(prior_claims,'') then raise exception 'identity not restored'; end if;
 results:=results||jsonb_build_array(c.name||': PASS');
 end loop;
 perform set_config('test.denial_results',results::text,true);
end; $$;
select current_setting('test.denial_results')::jsonb as stage_denial_results,
not has_function_privilege('authenticated','public.prepare_linked_fiscal_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid)','execute') as client_gateway_blocked,
not has_function_privilege('anon','public.prepare_linked_fiscal_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid)','execute') as anonymous_gateway_blocked;
reset role;
rollback;
