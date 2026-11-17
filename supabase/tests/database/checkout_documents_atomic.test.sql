begin;
select no_plan();
insert into auth.users(id,email) values(md5('discount-checkout-owner')::uuid,'discount-checkout@example.test');
select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('checkout-discount')::uuid,current_setting('test.org')::uuid,'pro',encode(extensions.digest('TEST-CODE','sha256'),'hex'),10000,2,1,now()+interval '1 day',auth.uid(),gen_random_uuid());
insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
values(md5('discounted-offer')::uuid,current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,12345,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1);


select set_config('test.quote',public.preview_sandbox_discount_offer(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,'TEST-CODE')::text,true);

insert into public.purchase_document_versions(id,kind,body,status) values('atomic-agreement','agreement','Synthetic agreement','published'),('atomic-payment','payment_terms','Synthetic payment','published');
select throws_ok($t$select platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'wrong','atomic-payment',true)$t$,'40001','purchase documents changed','stale documents reject checkout');
select is((select count(*)::int from public.billing_discount_checkouts),0,'rejection rolls back checkout');
select is((select count(*)::int from public.billing_discount_reservations),0,'rejection rolls back discount reserve');
select throws_ok($t$select platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-agreement','atomic-payment',false)$t$,'22023','documents not accepted','unchecked confirmation rejected');
select set_config('test.atomic',platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-agreement','atomic-payment',true)::text,true);
select is((current_setting('test.atomic')::jsonb->>'amount_minor'),'0','100 percent discount supported');
select is((select count(*)::int from public.checkout_document_acceptances),1,'acceptance recorded with checkout');
select is(platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-agreement','atomic-payment',true)::text,current_setting('test.atomic'),'lost response retry returns same snapshot');
insert into public.purchase_document_versions(id,kind,body,status) values('atomic-new','agreement','New synthetic agreement','published');
select is(platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-agreement','atomic-payment',true)::text,current_setting('test.atomic'),'retry preserves old accepted document after new publication');
select throws_ok($t$select platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-new','atomic-payment',true)$t$,'22023','checkout acceptance conflict','cannot replace receipt');
select ok(not has_function_privilege('authenticated','platform_private.accept_checkout_with_documents(uuid,uuid,uuid,text,jsonb,text,text,boolean)','execute'),'adapter not exposed before complete UI rollout');
insert into public.checkout_document_scope(organization_id) values(current_setting('test.org')::uuid);
insert into public.billing_sandbox_application_scope(organization_id) values(current_setting('test.org')::uuid) on conflict do nothing;
set local role authenticated;
select is((public.accept_sandbox_checkout_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-agreement','atomic-payment',true)->>'order_id'),(current_setting('test.atomic')::jsonb->>'order_id'),'public API restores accepted checkout under authenticated role');
reset role;
select throws_ok($t$select public.execute_sandbox_discount_checkout(current_setting('test.org')::uuid,gen_random_uuid())$t$,'42501','documents not accepted','execution requires acceptance within document scope');
select ok(not has_function_privilege('authenticated','public.execute_sandbox_discount_checkout_without_documents(uuid,uuid)','execute'),'legacy execution cannot bypass document guard');
select ok(not has_table_privilege('authenticated','public.checkout_document_scope','insert'),'client cannot change rollout scope');
select is((public.read_checkout_document_acceptance(current_setting('test.org')::uuid,(current_setting('test.atomic')::jsonb->>'order_id')::uuid)->>'agreement_id'),'atomic-agreement','recovery returns original document edition');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($t$select platform_private.accept_checkout_with_documents(current_setting('test.org')::uuid,md5('discounted-offer')::uuid,md5('atomic-command')::uuid,'TEST-CODE',current_setting('test.quote')::jsonb,'atomic-agreement','atomic-payment',true)$t$,'42501','billing management denied','another actor cannot recover acceptance');
select * from finish();rollback;
