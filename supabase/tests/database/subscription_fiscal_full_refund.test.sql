begin;
select no_plan();
insert into auth.users(id,email) values(md5('purchase-trial-owner')::uuid,'purchase-trial@example.test'),(md5('purchase-trial-other')::uuid,'purchase-trial-other@example.test');
select set_config('request.jwt.claim.sub',md5('purchase-trial-owner')::uuid::text,true);
insert into public.organizations(id,name) values('64701955-543c-b77b-23ba-ede86feb8728','sandbox-full-refund-20260929');
insert into public.organization_memberships(organization_id,user_id,status) values('64701955-543c-b77b-23ba-ede86feb8728',auth.uid(),'active');
insert into public.membership_roles(membership_id,role_id) select m.id,r.id from public.organization_memberships m cross join public.roles r where m.organization_id='64701955-543c-b77b-23ba-ede86feb8728' and m.user_id=auth.uid() and r.key='owner';
select set_config('test.org','64701955-543c-b77b-23ba-ede86feb8728',true);
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit)
values(md5('purchase-trial-v1')::uuid,'purchase_trial',1,'Trial 1',5,3),
(md5('purchase-trial-v2')::uuid,'purchase_trial',2,'Trial 2',6,3),
(md5('purchase-trial-other-plan')::uuid,'purchase_other',1,'Other',2,1);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('purchase-trial-v1')::uuid,md5('purchase-trial-v1')::uuid,'purchase_trial',now()-interval '2 days'),
(md5('purchase-trial-other-plan')::uuid,md5('purchase-trial-other-plan')::uuid,'purchase_other',now()-interval '1 day');
select public.request_organization_trial(current_setting('test.org')::uuid,md5('purchase-trial-v1')::uuid,repeat('a',64),md5('purchase-trial-start')::uuid,0);
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
values(md5('purchase-trial-v2')::uuid,md5('purchase-trial-v2')::uuid,'purchase_trial',now()-interval '1 day');
select set_config('test.before',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);

update public.billing_trial_access set ends_at=clock_timestamp()+interval '1 day' where organization_id=current_setting('test.org')::uuid;
update public.organization_subscriptions set period_end=(select ends_at from public.billing_trial_access where organization_id=current_setting('test.org')::uuid) where organization_id=current_setting('test.org')::uuid;
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('trial-discount')::uuid,current_setting('test.org')::uuid,'purchase_trial',encode(extensions.digest('TRIAL-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-offer')::uuid,s.organization_id,md5('purchase-trial-v2')::uuid,s.revision,99000,'1467641','https://stage.qvesta.ru',s.period_end,
 ((s.period_end at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)
values(md5('future-policy')::uuid,'sandbox','1467641',clock_timestamp()+interval '1 second',1,'service','full_prepayment');
insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)
values(md5('future-policy')::uuid,'subscription','subscription_access_v1','ausn','period_end');
select pg_sleep(1.1);
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);

insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select public.prepare_sandbox_receipt(current_setting('test.order')::uuid,'future@example.test');
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select public.record_sandbox_payment_result(current_setting('test.order')::uuid,md5('trial-refund-payment')::uuid,'succeeded',true,true,null);
select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid);
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
select set_config('test.request',public.request_platform_subscription_refund(current_setting('test.org')::uuid,current_setting('test.order')::uuid,gen_random_uuid())->>'id',true);
select platform_private.bind_subscription_refund_period(current_setting('test.request')::uuid);
select lives_ok($$select platform_private.check_subscription_refund_access(current_setting('test.request')::uuid)$$,'trial period passes access preflight');
select is((select status from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),'trial','preflight does not advance trial');
select set_config('test.trial',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);
select is((select amount_minor from public.subscription_refund_requests where id=current_setting('test.request')::uuid),99000::bigint,'future period refund is full price');
-- FULL_REFUND_TARGET_CHECK
-- Simulated provider-confirmed original receipt, no network or real payment.
insert into public.billing_receipt_payment_requests(order_id,idempotency_key,body,body_sha256)
select o.id,o.idempotency_key,jsonb_build_object('receipt',jsonb_build_object('customer',jsonb_build_object('email',r.email),
 'items',jsonb_build_array(jsonb_build_object('description',r.description,'quantity','1.000','amount',jsonb_build_object('value','990.00','currency','RUB'),
 'vat_code',r.vat_code,'payment_subject',r.payment_subject,'payment_mode',r.payment_mode)))),repeat('a',64)
from public.billing_sandbox_orders o join public.billing_receipt_snapshots r on r.order_id=o.id where o.id=current_setting('test.order')::uuid;
insert into public.billing_receipt_payment_status(order_id,payment_id,status)
values(current_setting('test.order')::uuid,md5('trial-refund-payment')::uuid,'succeeded');
-- FULL_REFUND_BODY_COMPATIBILITY
select set_config('test.future.reserve',platform_private.reserve_linked_subscription_fiscal_refund(current_setting('test.request')::uuid)::text,true);
select is(platform_private.reserve_linked_subscription_fiscal_refund(current_setting('test.request')::uuid)::text,current_setting('test.future.reserve'),'full refund reserve retry preserves pair');
select is((select quantity_units from public.billing_subscription_fiscal_operations where command_id=current_setting('test.request')::uuid),1000000::bigint,'full refund consumes whole receipt quantity');
select is(platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.request')::uuid)->>'action','send','full refund first claim sends');
select is(platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.request')::uuid)->>'action','reconcile','full refund retry never resends');
select ok(not ((select body from public.billing_subscription_fiscal_operations where command_id=current_setting('test.request')::uuid) ? 'receipt'),'new full refund stores no receipt');
select is((select body_sha256 from public.billing_subscription_fiscal_operations where command_id=current_setting('test.request')::uuid),
 (select encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex') from public.billing_subscription_fiscal_operations where command_id=current_setting('test.request')::uuid),'new full refund hashes exact provider body');
select set_config('test.full.new.claim',platform_private.claim_linked_subscription_fiscal_refund(current_setting('test.request')::uuid)::text,true);
select is(current_setting('test.full.new.claim')::jsonb#>>'{expectedItems,0,quantity}','1.000000','new full refund retains expected quantity outside request');
select is(current_setting('test.full.new.claim')::jsonb#>>'{expectedItems,0,payment_mode}','full_prepayment','new full refund retains expected payment mode');
select is(current_setting('test.full.new.claim')::jsonb#>>'{expectedItems,0,amount,value}','990.00','new full refund retains original unit price');
select is(current_setting('test.full.new.claim')::jsonb->'body',(select body from public.billing_subscription_fiscal_operations where command_id=current_setting('test.request')::uuid),'claim never rewrites new provider body');
select set_config('test.future.result',jsonb_build_object('commandId',x.command_id,'paymentId',l.payment_id,'shopId','1467641','bodySha256',x.body_sha256,
 'amountMinor',x.amount_minor,'state','succeeded','refundId',md5('future-refund')::uuid,'receiptId','ra-'||md5('future-receipt')::uuid::text,'receiptStatus','succeeded')::text,true)
from public.billing_subscription_fiscal_operations x join public.billing_subscription_fiscal_ledgers l on l.order_id=x.order_id where x.command_id=current_setting('test.request')::uuid;
select platform_private.record_linked_subscription_fiscal_refund(current_setting('test.request')::uuid,current_setting('test.future.result')::jsonb);
select platform_private.record_linked_subscription_fiscal_refund(current_setting('test.request')::uuid,current_setting('test.future.result')::jsonb);
select is((select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.trial'),'full fiscal refund preserves current trial');
select is((select (public.effective_trial_subscription(s,s.period_end)).status from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),'free','full fiscal refund prevents future activation');
select throws_ok($t$select platform_private.fulfill_discount_payment(current_setting('test.order')::uuid)$t$,'55000','subscription period refunded','full fiscal refund blocks payment fulfillment replay');
select is((select count(*) from public.subscription_refund_applications where request_id=current_setting('test.request')::uuid),1::bigint,'full refund access applied exactly once');
select is((select count(*) from public.billing_sandbox_refunds where fiscal_command_id=current_setting('test.request')::uuid),1::bigint,'one full monetary refund');
select is((select count(*) from public.billing_subscription_fiscal_operations where order_id=current_setting('test.order')::uuid),1::bigint,'one fiscal operation and no settlement');
select is((select l.amount_minor-sum(x.amount_minor) from public.billing_subscription_fiscal_ledgers l join public.billing_subscription_fiscal_operations x on x.order_id=l.order_id join public.billing_subscription_fiscal_operation_status s using(command_id) where l.order_id=current_setting('test.order')::uuid and s.state='succeeded' group by l.amount_minor),0::numeric,'full refund leaves zero balance');
-- Advance only synthetic fiscal terms to exercise post-end selection, never a shared DB.
alter table public.billing_subscription_fiscal_terms disable trigger subscription_fiscal_terms_immutable;
update public.billing_subscription_fiscal_terms set period_start=now()-interval '1 hour',period_end=now()-interval '30 minutes' where order_id=current_setting('test.order')::uuid;
alter table public.billing_subscription_fiscal_terms enable trigger subscription_fiscal_terms_immutable;
select is(public.list_subscription_fiscal_order_work('1467641',current_setting('test.order')::uuid,'due'), '[]'::jsonb,'fully refunded order never becomes due after period end');
select throws_ok($t$select public.subscription_fiscal_worker_gateway('1467641','claim_settlement',current_setting('test.order')::uuid)$t$,'22023','invalid fiscal command','zero settlement cannot be reserved even directly');
select * from finish();
rollback;
