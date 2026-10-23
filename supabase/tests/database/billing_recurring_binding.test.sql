begin;
select no_plan();
create function pg_temp.prepare_recurring(k text) returns uuid language plpgsql as $$
declare org uuid; o uuid;
begin
 insert into auth.users(id,email) values(md5(k)::uuid,k||'@example.test');
 perform set_config('request.jwt.claim.sub',md5(k)::uuid::text,true);
 select id into org from public.organizations where personal_owner_id=auth.uid();
 insert into public.billing_sandbox_application_scope values(org);
 o:=(public.reserve_sandbox_payment_order(org,gen_random_uuid(),0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),100,'123','https://stage.qvesta.ru',now()-interval '1 day',now()+interval '30 days')->>'id')::uuid;
 perform public.request_sandbox_recurring_consent(org,o,'sandbox-recurring-v2');
 perform public.begin_sandbox_payment_send(o);
 return o;
end; $$;
create function pg_temp.recurring_event(o uuid, method text, status text default 'succeeded') returns jsonb language plpgsql as $$
declare e uuid;
begin
 e:=public.enqueue_sandbox_payment_event('123',o,md5(o::text)::uuid,'reconciliation');
 return public.apply_sandbox_payment_event(e,jsonb_build_object('paymentId',md5(o::text)::uuid,'status',status,'paid',status='succeeded','test',true,'savedMethodId',method));
end; $$;
select set_config('test.active',pg_temp.prepare_recurring('recurring-bind-active')::text,true);
select set_config('test.revoked',pg_temp.prepare_recurring('recurring-bind-revoked')::text,true);
select set_config('test.pending',pg_temp.prepare_recurring('recurring-bind-pending')::text,true);
select set_config('test.invalid',pg_temp.prepare_recurring('recurring-bind-invalid')::text,true);
select set_config('request.jwt.claim.sub',md5('recurring-bind-revoked')::uuid::text,true);
select public.revoke_sandbox_recurring_consent(c.organization_id,c.id) from public.billing_recurring_consents c where order_id=current_setting('test.revoked')::uuid;
set local role service_role;
select is(pg_temp.recurring_event(current_setting('test.active')::uuid,'synthetic-method')->>'fulfillmentState','applied','подтверждённый платёж применяется');
select is(pg_temp.recurring_event(current_setting('test.active')::uuid,'synthetic-method')->>'fulfillmentState','applied','повтор события идемпотентен');
select throws_ok($t$select pg_temp.recurring_event(current_setting('test.active')::uuid,'changed-method')$t$,'22023','recurring method conflict','нельзя заменить сохранённый метод повтором');
select lives_ok($t$select pg_temp.recurring_event(current_setting('test.revoked')::uuid,'revoked-method')$t$,'платёж после отзыва обрабатывается без привязки');
select lives_ok($t$select pg_temp.recurring_event(current_setting('test.pending')::uuid,'pending-method','pending')$t$,'pending не выдаёт способ оплаты');
select lives_ok($t$select pg_temp.recurring_event(current_setting('test.invalid')::uuid,'../invalid')$t$,'невалидный метод не мешает применить оплату');
reset role;
select is((select count(*) from public.billing_recurring_methods m join public.billing_recurring_consents c on c.id=m.consent_id where c.order_id=current_setting('test.active')::uuid),1::bigint,'один метод после повторов');
select is((select provider_method_id from public.billing_recurring_methods m join public.billing_recurring_consents c on c.id=m.consent_id where c.order_id=current_setting('test.active')::uuid),'synthetic-method','исходный метод сохранён');
select is((select count(*) from public.billing_recurring_methods m join public.billing_recurring_consents c on c.id=m.consent_id where c.order_id in(current_setting('test.revoked')::uuid,current_setting('test.pending')::uuid,current_setting('test.invalid')::uuid)),0::bigint,'отозванный, ожидающий и невалидный методы не записаны');
select ok(not has_function_privilege('authenticated','platform_private.bind_sandbox_recurring_method(uuid,jsonb)','execute'),'клиент не привязывает метод');
select ok(not has_function_privilege('service_role','platform_private.bind_sandbox_recurring_method(uuid,jsonb)','execute'),'прямой RPC привязки закрыт');
select * from finish();
rollback;
