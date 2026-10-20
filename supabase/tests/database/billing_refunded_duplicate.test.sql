begin;
select no_plan();
insert into auth.users(id,email) values(md5('purchase-trial-owner')::uuid,'purchase-trial@example.test'),(md5('purchase-trial-other')::uuid,'purchase-trial-other@example.test');
select set_config('request.jwt.claim.sub',md5('purchase-trial-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
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

update public.billing_trial_access set ends_at=clock_timestamp()+interval '1 hour' where organization_id=current_setting('test.org')::uuid;
update public.organization_subscriptions set period_end=(select ends_at from public.billing_trial_access where organization_id=current_setting('test.org')::uuid) where organization_id=current_setting('test.org')::uuid;
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('trial-discount')::uuid,current_setting('test.org')::uuid,'purchase_trial',encode(extensions.digest('TRIAL-CODE','sha256'),'hex'),5000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('trial-offer')::uuid,s.organization_id,md5('purchase-trial-v2')::uuid,s.revision,10000,'123','https://stage.qvesta.ru',s.period_end,
 ((s.period_end at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions s where s.organization_id=current_setting('test.org')::uuid;
select set_config('test.accepted',platform_private.accept_discount_checkout(current_setting('test.org')::uuid,md5('trial-offer')::uuid,md5('trial-command')::uuid,'')::text,true);

select set_config('test.order',current_setting('test.accepted')::jsonb->>'order_id',true);
select platform_private.prepare_discount_payment(current_setting('test.order')::uuid);
select public.begin_sandbox_payment_send(current_setting('test.order')::uuid);
select throws_ok($t$select platform_private.schedule_confirmed_period_after_trial(current_setting('test.order')::uuid)$t$,'55000','zero trial checkout required','общий исполнитель не обходит неподтверждённую оплату');
insert into public.billing_sandbox_application_scope values(current_setting('test.org')::uuid);
select public.record_sandbox_payment_result_internal(current_setting('test.order')::uuid,md5('trial-money-provider')::uuid,'succeeded',true,true,null);

insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('trial-money-event')::uuid,current_setting('test.order')::uuid,md5('trial-money-provider')::uuid,'payment.succeeded');
select is(public.apply_sandbox_payment_event(md5('trial-money-event')::uuid,jsonb_build_object('paymentId',md5('trial-money-provider')::uuid,'status','succeeded','paid',true,'test',true))->>'fulfillmentState','applied','вход через событие провайдера применяет условия trial');

select set_config('test.duplicate',gen_random_uuid()::text,true);
insert into public.billing_discount_reservations select (jsonb_populate_record(null::public.billing_discount_reservations,to_jsonb(r)||jsonb_build_object('order_id',current_setting('test.duplicate'),'state','reserved','settled_at',null))).* from public.billing_discount_reservations r where order_id=current_setting('test.order')::uuid;
insert into public.billing_discount_checkouts select (jsonb_populate_record(null::public.billing_discount_checkouts,to_jsonb(c)||jsonb_build_object('id',current_setting('test.duplicate'),'command_id',gen_random_uuid()))).* from public.billing_discount_checkouts c where id=current_setting('test.order')::uuid;
insert into public.billing_sandbox_orders select (jsonb_populate_record(null::public.billing_sandbox_orders,to_jsonb(o)||jsonb_build_object('id',current_setting('test.duplicate'),'command_id',gen_random_uuid(),'idempotency_key',gen_random_uuid(),'state','review'))).* from public.billing_sandbox_orders o where id=current_setting('test.order')::uuid;
insert into public.billing_discount_payment_links(checkout_id,payment_order_id) values(current_setting('test.duplicate')::uuid,current_setting('test.duplicate')::uuid);
insert into public.billing_sandbox_payment_results select (jsonb_populate_record(null::public.billing_sandbox_payment_results,to_jsonb(p)||jsonb_build_object('order_id',current_setting('test.duplicate'),'payment_id',md5('duplicate-payment')::uuid))).* from public.billing_sandbox_payment_results p where order_id=current_setting('test.order')::uuid;
select is(platform_private.resolve_refunded_trial_duplicate(current_setting('test.duplicate')::uuid),false,'unrefunded duplicate remains open');
insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id,state,provider_refund_id) values(current_setting('test.duplicate')::uuid,auth.uid(),gen_random_uuid(),5000,md5('duplicate-payment')::uuid,'succeeded',gen_random_uuid());
select is(platform_private.resolve_refunded_trial_duplicate(current_setting('test.duplicate')::uuid),false,'partial refund remains open');
insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id,state,provider_refund_id) values(current_setting('test.duplicate')::uuid,auth.uid(),gen_random_uuid(),5000,md5('duplicate-payment')::uuid,'succeeded',gen_random_uuid());
select set_config('test.subscription',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);
select is(platform_private.resolve_refunded_trial_duplicate(current_setting('test.duplicate')::uuid),true,'fully refunded duplicate resolved');
select is(platform_private.resolve_refunded_trial_duplicate(current_setting('test.duplicate')::uuid),true,'retry is idempotent');
select is((select count(*) from public.billing_refunded_duplicate_resolutions where order_id=current_setting('test.duplicate')::uuid),1::bigint,'one audit record');
select is((select state from public.billing_sandbox_orders where id=current_setting('test.duplicate')::uuid),'finished','order closed');
select is((select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.subscription'),'subscription unchanged');
select is((select count(*) from public.billing_trial_paid_periods where organization_id=current_setting('test.org')::uuid),1::bigint,'original paid period preserved');
select is(platform_private.resolve_refunded_trial_duplicate(current_setting('test.order')::uuid),false,'fulfilled original cannot be resolved as duplicate');
select ok((select relrowsecurity from pg_class where oid='public.billing_refunded_duplicate_resolutions'::regclass),'audit has RLS');
select ok(not has_table_privilege('authenticated','public.billing_refunded_duplicate_resolutions','insert'),'client cannot forge audit');
select ok(not has_function_privilege('authenticated','platform_private.resolve_refunded_trial_duplicate(uuid)','execute'),'client cannot resolve directly');
insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values(md5('duplicate-event')::uuid,current_setting('test.duplicate')::uuid,md5('duplicate-payment')::uuid,'reconciliation');
select is(public.apply_sandbox_payment_event(md5('duplicate-event')::uuid,jsonb_build_object('paymentId',md5('duplicate-payment')::uuid,'status','succeeded','paid',true,'test',true))->>'reason','fully_refunded_trial_duplicate','replayed payment reports resolution');
select is((select count(*) from public.billing_trial_paid_periods where organization_id=current_setting('test.org')::uuid),1::bigint,'replayed event does not issue access');
select * from finish(); rollback;
