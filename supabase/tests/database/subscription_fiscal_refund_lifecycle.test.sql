-- Verified provider results are synthetic; there are no network calls.
create function pg_temp.linked_result(state text,receipt text) returns jsonb language sql as $$
 select jsonb_build_object('commandId',x.command_id,'paymentId',l.payment_id,'shopId','123','bodySha256',x.body_sha256,
 'amountMinor',x.amount_minor,'state',state,'refundId',md5('linked-provider-refund')::uuid,
 'receiptId',case when receipt in ('pending','succeeded','canceled') then 'ra-'||md5('linked-provider-receipt')::uuid::text else null end,'receiptStatus',receipt)
 from public.billing_subscription_fiscal_operations x join public.billing_subscription_fiscal_ledgers l on l.order_id=x.order_id
 where x.command_id=current_setting('test.link.request')::uuid;
$$;
savepoint linked_lifecycle;
set local role authenticated;
select throws_ok($$select public.subscription_fiscal_refund_from_gateway(null,null,null,null,'claim',null)$$,'42501',null,'browser cannot call fiscal execution gateway');
set local role service_role;
select throws_ok($$select platform_private.claim_linked_subscription_fiscal_refund(null)$$,'42501',null,'service cannot bypass fiscal claim gateway');
select throws_ok($$select platform_private.record_linked_subscription_fiscal_refund(null,null)$$,'42501',null,'service cannot forge linked results directly');
select throws_ok($$select public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,0,9999999999,'123','claim',current_setting('test.link.request')::uuid)$$,'42501','invalid fiscal refund gateway context','execution gateway rejects stale MFA');
select throws_ok($$select public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'456','claim',current_setting('test.link.request')::uuid)$$,'42501','fiscal refund scope denied','execution gateway rejects foreign shop');
select throws_ok($$select public.subscription_fiscal_refund_from_gateway(md5('receipt-other-user')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123','claim',current_setting('test.link.request')::uuid)$$,'42501','platform owner required','execution gateway rejects non-owner');
select set_config('test.link.claim',public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123','claim',current_setting('test.link.request')::uuid)::text,true);
reset role;
select is(current_setting('request.jwt.claims'),current_setting('test.link.claims'),'execution gateway restores caller identity');
select is(current_setting('test.link.claim')::jsonb->>'action','send','linked first claim authorizes one send');
select is(platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid)->>'action','reconcile','linked retry only reconciles');
select ok((select f.first_sent_at=s.first_sent_at and f.first_sent_at=d.authorized_at
 from public.billing_sandbox_refunds f join public.billing_subscription_fiscal_operation_status s on s.command_id=f.fiscal_command_id
 join public.subscription_refund_dispatches d on d.refund_id=f.id),'both journals share first-send time');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','claim preserves access');
select throws_ok($$select public.subscription_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'recover',(current_setting('test.link.result')::jsonb->>'refundId')::uuid)$$,'55000','linked fiscal refund requires fiscal gateway','old endpoint cannot resend claimed fiscal refund');

select ok(platform_private.check_linked_fiscal_refund_send(current_setting('test.link.request')::uuid,current_setting('test.link.claim')::jsonb)->>'authorized'='true','fresh send authorization preserves exact claim');
select throws_ok($$select platform_private.check_linked_fiscal_refund_send(current_setting('test.link.request')::uuid,current_setting('test.link.claim')::jsonb||jsonb_build_object('sha256','wrong'))$$,'55000','fiscal send denied','changed fingerprint cannot authorize send');
select ok(not(platform_private.read_linked_fiscal_refund_status(current_setting('test.link.request')::uuid)?|array['body','email','key','paymentId']),'safe endpoint status omits private fiscal data');
savepoint before_send_access;
update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id=current_setting('test.org')::uuid;
select throws_ok($$select platform_private.check_linked_fiscal_refund_send(current_setting('test.link.request')::uuid,current_setting('test.link.claim')::jsonb)$$,'55000','subscription refund access review required','changed access after claim prevents POST authorization');
rollback to before_send_access;
select platform_private.mark_subscription_fiscal_review(current_setting('test.link.request')::uuid,'provider_mismatch');
select throws_ok($$select platform_private.check_linked_fiscal_refund_send(current_setting('test.link.request')::uuid,current_setting('test.link.claim')::jsonb)$$,'55000','fiscal send denied','review after claim prevents POST authorization');
rollback to before_send_access;
set local role service_role;
select is(public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123','status',current_setting('test.link.request')::uuid)->>'state','sending','authorized gateway reads safe money state');
select ok(public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123','before_send',current_setting('test.link.request')::uuid,current_setting('test.link.claim')::jsonb)->>'authorized'='true','gateway authorizes exact send after checks');
select throws_ok($$select public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,0,9999999999,'123','before_send',current_setting('test.link.request')::uuid,current_setting('test.link.claim')::jsonb)$$,'42501','invalid fiscal refund gateway context','expired MFA after claim prevents POST authorization');
select throws_ok($$select platform_private.check_linked_fiscal_refund_send(null,null)$$,'42501',null,'direct send authorization bypass denied');
reset role;
create function pg_temp.fail_linked_result() returns trigger language plpgsql as $$begin raise exception 'synthetic money record failure' using errcode='55000'; end;$$;
create trigger zz_test_link_result before update on public.billing_sandbox_refunds for each row execute function pg_temp.fail_linked_result();
select throws_ok($$select platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('succeeded','unknown'))$$,'55000','synthetic money record failure','money write failure rolls back fiscal result');
select is((select state from public.billing_subscription_fiscal_operation_status where command_id=current_setting('test.link.request')::uuid),'unknown','failed money record preserves recoverable unknown');
select is((select state from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),'sending','failed money record preserves original send');
drop trigger zz_test_link_result on public.billing_sandbox_refunds;
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('pending',null))->>'accessState','not_applied','pending money does not change access');
select throws_ok($$select platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('succeeded','unknown')||jsonb_build_object('amountMinor',1))$$,'22023','fiscal result invalid','linked result rejects changed amount');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','invalid result preserves access');
select set_config('test.link.provider',pg_temp.linked_result('succeeded','unknown')::text,true);
set local role service_role;
select is(public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123','record',current_setting('test.link.request')::uuid,current_setting('test.link.provider')::jsonb)->>'accessState','applied','verified money applies access before receipt arrives');
reset role;
select throws_ok($$select platform_private.reserve_subscription_fiscal_operation(current_setting('test.payment')::uuid,md5('linked-next')::uuid,1,'refund',100)$$,'55000','fiscal operation unresolved','linked money success still waits for its receipt');
select is((select state from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),'succeeded','money journal receives verified success');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'free','linked success switches exact paid period to Free');
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('pending',null))->>'state','succeeded','late pending cannot undo linked success');
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('succeeded','succeeded'))->>'receiptStatus','succeeded','receipt confirmation joins monetary success');
select is((select count(*) from public.subscription_refund_applications),1::bigint,'replayed results apply access once');
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('canceled',null))->>'state','review','conflicting monetary result requires fiscal review');
select is((select state from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),'succeeded','conflict preserves verified monetary success');
select is((select count(*) from public.subscription_refund_applications),1::bigint,'conflict never reapplies access');
-- Return to the reserved pair for an independent access-review scenario.
rollback to linked_lifecycle;
select platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid);
update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id=current_setting('test.org')::uuid;
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('succeeded','unknown'))->>'accessState','review_required','changed period sends access application to review');
select is((select state from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),'succeeded','access review does not lose monetary success');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'active','unrelated period is not revoked');
update public.organization_subscriptions set period_end=period_end-interval '1 day' where organization_id=current_setting('test.org')::uuid;
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('succeeded','succeeded'))->>'accessState','applied','access retry succeeds without another provider send');
rollback to linked_lifecycle;
select platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid);
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('canceled',null))->>'accessState','not_applied','canceled refund preserves access');
select is((select state from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),'canceled','cancellation reaches monetary journal');
rollback to linked_lifecycle;
select platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid);
select is(platform_private.record_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid,pg_temp.linked_result('succeeded','canceled'))->>'state','review','canceled receipt requires review despite money success');
select is((select state from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.link.request')::uuid),'succeeded','canceled receipt cannot undo money');
select is((select count(*) from public.subscription_refund_applications),1::bigint,'canceled receipt still applies confirmed monetary refund');
rollback to linked_lifecycle;
-- Worker reconciliation uses the saved dispatch authorization, not an expired actor session.
select platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.link.request')::uuid);
select set_config('test.worker.link.result',pg_temp.linked_result('succeeded','unknown')::text,true);
set local role service_role;
select is(public.subscription_fiscal_worker_gateway('123','read',null,current_setting('test.link.request')::uuid)->>'action','reconcile','worker reads linked refund without claiming another send');
select is(public.subscription_fiscal_worker_gateway('123','record',null,current_setting('test.link.request')::uuid,current_setting('test.worker.link.result')::jsonb)->>'accessState','applied','worker applies confirmed refund access');
select is(jsonb_array_length(public.list_subscription_fiscal_work('123','reconcile')),1,'linked receipt delay remains in new reconciliation queue');
select is(jsonb_array_length(public.list_sandbox_refund_reconciliation('123')),0,'legacy refund queue excludes linked refund');
select throws_ok($$select public.subscription_fiscal_worker_gateway('123','before_send',null,current_setting('test.link.request')::uuid,'{}'::jsonb)$$,'55000','fiscal worker send denied','worker never authorizes refund POST');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
set local role authenticated;
select is(public.read_platform_order_refunds(current_setting('test.org')::uuid,current_setting('test.payment')::uuid)#>>'{items,0,fiscal,receipt_status}','unknown','refund history separates delayed receipt from succeeded money');
reset role;
rollback to linked_lifecycle;
