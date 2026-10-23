-- Appended to a modeled paid checkout in the disposable full-schema transaction.
reset role;
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'123',md5('fiscal-payment')::uuid,'succeeded',true)
 on conflict(order_id) do update set status='succeeded',paid=true,payment_id=md5('fiscal-payment')::uuid,requires_review=false;
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid) on conflict do nothing;
select set_config('test.link.request',public.request_platform_subscription_refund(current_setting('test.org')::uuid,current_setting('test.payment')::uuid,md5('linked-refund-command')::uuid)->>'id',true);
select throws_ok($$select platform_private.reserve_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid)$$,'55000','subscription refund period not issued','linked reserve requires issued period');
select is((select count(*) from public.billing_subscription_fiscal_ledgers),0::bigint,'unissued period creates no ledger');
update public.organization_subscriptions s set status='active',plan_version_id=o.plan_version_id,period_start=o.period_start,period_end=o.period_end
 from public.billing_sandbox_orders o where o.id=current_setting('test.payment')::uuid and s.organization_id=o.organization_id;
insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
 select id,organization_id,jsonb_build_object('plan',plan_version_id,'start',period_start,'end',period_end),'{}',
 jsonb_build_object('revision',(select revision from public.organization_subscriptions where organization_id=o.organization_id))
 from public.billing_sandbox_orders o where id=current_setting('test.payment')::uuid;
savepoint linked_ready;
update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id=current_setting('test.org')::uuid;
select throws_ok($$select platform_private.reserve_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid)$$,'55000','subscription refund access review required','changed access prevents both reserves');
select is((select count(*) from public.billing_subscription_fiscal_operations),0::bigint,'changed access creates no fiscal reserve');
rollback to linked_ready;
-- A late failure in the money insert must roll back the earlier fiscal insert and period binding.
create function pg_temp.reject_linked_money() returns trigger language plpgsql as $$begin raise exception 'synthetic money insert failure' using errcode='55000'; end;$$;
create trigger zz_test_link_failure before insert on public.billing_sandbox_refunds for each row execute function pg_temp.reject_linked_money();
select throws_ok($$select platform_private.reserve_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid)$$,'55000','synthetic money insert failure','late money failure rolls back atomic reserve');
select is((select count(*) from public.billing_subscription_fiscal_ledgers),0::bigint,'late failure leaves no fiscal ledger');
select is((select count(*) from public.subscription_refund_period_bindings),0::bigint,'late failure leaves no period binding');
drop trigger zz_test_link_failure on public.billing_sandbox_refunds;
select set_config('test.link.claims',current_setting('request.jwt.claims'),true);
set local role service_role;
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,0,9999999999,'123',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)$$,'42501','invalid fiscal refund preparation context','linked gateway rejects stale MFA');
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,0,'123',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)$$,'42501','invalid fiscal refund preparation context','linked gateway rejects expired identity');
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'456',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)$$,'42501','fiscal refund scope denied','linked gateway rejects foreign shop');
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123',gen_random_uuid(),current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)$$,'42501','fiscal refund scope denied','linked gateway rejects foreign organization');
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,gen_random_uuid())$$,'42501','fiscal refund scope denied','linked gateway rejects foreign request');
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(md5('receipt-other-user')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)$$,'42501','platform owner required','linked gateway rejects non-owner');
select is(current_setting('request.jwt.claims'),current_setting('test.link.claims'),'failed gateway restores identity');
select set_config('test.link.result',public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)::text,true);
select is(public.prepare_linked_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123',current_setting('test.org')::uuid,current_setting('test.payment')::uuid,current_setting('test.link.request')::uuid)::text,current_setting('test.link.result'),'linked retry returns same pair');
select is(current_setting('request.jwt.claims'),current_setting('test.link.claims'),'successful gateway restores identity');
select ok(not(current_setting('test.link.result')::jsonb ?| array['body','email','key','actorId','paymentId']),'gateway omits fiscal body and contact');
select throws_ok($$select platform_private.reserve_linked_subscription_fiscal_refund(null)$$,'42501',null,'service cannot bypass preparation gateway');
reset role;
select is((select count(*) from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),1::bigint,'one linked monetary reserve');
select is((select count(*) from public.billing_subscription_fiscal_operations),1::bigint,'one linked fiscal reserve');
select ok((select f.amount_minor=x.amount_minor and f.command_id=x.command_id and f.order_id=x.order_id and r.amount_minor=x.amount_minor
 from public.billing_sandbox_refunds f join public.billing_subscription_fiscal_operations x on x.command_id=f.fiscal_command_id
 join public.subscription_refund_requests r on r.id=x.command_id),'request and both reserves agree');
select is((select version from public.billing_subscription_fiscal_ledgers),1::bigint,'retry preserves ledger version');
select is((select count(*) from public.subscription_refund_dispatches),0::bigint,'preparation grants no legacy send');
select is((select count(*) from public.billing_subscription_fiscal_operation_status where first_sent_at is not null),0::bigint,'preparation does not claim fiscal send');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','preparation preserves active access');
select throws_ok($$select platform_private.claim_subscription_refund_dispatch((current_setting('test.link.result')::jsonb->>'refundId')::uuid)$$,'55000','linked fiscal refund execution not enabled','legacy sender cannot dispatch linked refund');
select is((select count(*) from public.subscription_refund_dispatches),0::bigint,'failed legacy claim rolls back authorization');
select throws_ok($$update public.billing_sandbox_refunds set fiscal_command_id=null where fiscal_command_id=current_setting('test.link.request')::uuid$$,'55000','linked fiscal refund execution not enabled','fiscal link cannot be removed');
select throws_ok($$select platform_private.apply_subscription_refund(current_setting('test.link.request')::uuid)$$,'55000','subscription refund not confirmed','reserve cannot revoke access');
-- LINKED_LIFECYCLE_CHECKS
set local role authenticated;
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(null,null,null,null,null,null,null)$$,'42501',null,'browser cannot impersonate fiscal gateway');
select throws_ok($$select fiscal_command_id from public.billing_sandbox_refunds$$,'42501',null,'browser cannot read fiscal links directly');
set local role anon;
select throws_ok($$select public.prepare_linked_fiscal_refund_from_gateway(null,null,null,null,null,null,null)$$,'42501',null,'anonymous fiscal gateway denied');
reset role;
rollback to linked_ready;
select set_config('test.link.legacy',public.reserve_platform_subscription_refund(current_setting('test.link.request')::uuid)::text,true);
select throws_ok($$select platform_private.reserve_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid)$$,'55000','legacy refund cannot be relinked','legacy reservation is never silently imported');
select is((select count(*) from public.billing_subscription_fiscal_ledgers),0::bigint,'legacy rejection leaves no fiscal ledger');
