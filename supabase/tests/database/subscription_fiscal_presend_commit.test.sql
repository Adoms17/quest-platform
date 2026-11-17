-- Appended after the modeled paid checkout and linked binding prefix.
-- COMMIT is intentional: the runner checks refusals and retries in new sessions.
-- Disposable production-baseline harness ONLY; never run on a shared/stage DB.
set local role service_role;
select set_config('test.presend.claim',public.subscription_fiscal_refund_from_gateway(
 md5('discount-checkout-owner')::uuid,
 floor(extract(epoch from clock_timestamp()))::bigint,
 floor(extract(epoch from clock_timestamp()))::bigint+300,
 '123','claim',current_setting('test.link.request')::uuid)::text,true);
reset role;
select is(current_setting('test.presend.claim')::jsonb->>'action','send','first claim grants one dispatch');
select is((select count(*) from public.subscription_refund_dispatches),1::bigint,'claim persists one dispatch');
select is((select count(*) from public.subscription_refund_applications),0::bigint,'claim does not apply access');
select ok((select f.first_sent_at=s.first_sent_at and f.first_sent_at=d.authorized_at
 from public.billing_sandbox_refunds f
 join public.billing_subscription_fiscal_operation_status s on s.command_id=f.fiscal_command_id
 join public.subscription_refund_dispatches d on d.refund_id=f.id),'claim timestamps agree');
select * from finish();
select 'PRESEND_CLAIM|'||current_setting('test.presend.claim');
commit;
