begin;
select no_plan();
-- Синтетические подтверждения после границы проверки API; внешних платежей нет.
create function pg_temp.payment(o uuid, status text) returns jsonb language plpgsql as $$
declare e uuid;
begin
 e:=public.enqueue_sandbox_payment_event('123',o,md5(o::text)::uuid,'reconciliation');
 return public.apply_sandbox_payment_event(e,jsonb_build_object('paymentId',md5(o::text)::uuid,'status',status,'paid',status='succeeded','test',true));
end;$$;
create function pg_temp.prepare_renewal(k text, future boolean default false) returns uuid language plpgsql as $$
declare org uuid; p uuid; first_order uuid; renewal uuid; s public.organization_subscriptions%rowtype;
begin
 insert into auth.users(id,email) values(md5(k)::uuid,k||'@example.test');
 perform set_config('request.jwt.claim.sub',md5(k)::uuid::text,true);
 select id into org from public.organizations where personal_owner_id=auth.uid();
 select id into p from public.billing_plan_versions where plan_key='pro' and version=1;
 insert into public.billing_sandbox_application_scope values(org);
 first_order:=(public.reserve_sandbox_payment_order(org,gen_random_uuid(),0,p,100,'123','https://stage.qvesta.ru',now()-interval '1 day',now()+interval '1 day')->>'id')::uuid;
 perform public.begin_sandbox_payment_send(first_order);
 perform pg_temp.payment(first_order,'succeeded');
 select * into s from public.organization_subscriptions where organization_id=org;
 renewal:=(public.reserve_sandbox_payment_order(org,gen_random_uuid(),s.revision,p,100,'123','https://stage.qvesta.ru',case when future then s.period_end else s.period_start end,s.period_end+interval '30 days')->>'id')::uuid;
 perform public.begin_sandbox_payment_send(renewal);
 return renewal;
end;$$;
select set_config('test.renewal',pg_temp.prepare_renewal('sandbox-renew-success')::text,true);
select set_config('test.canceled',pg_temp.prepare_renewal('sandbox-renew-cancel')::text,true);
select set_config('test.future',pg_temp.prepare_renewal('sandbox-renew-future',true)::text,true);
select set_config('test.conflict',pg_temp.prepare_renewal('sandbox-renew-conflict')::text,true);
create temporary table before_subscriptions as select s.* from public.organization_subscriptions s
 join public.billing_sandbox_orders o on o.organization_id=s.organization_id
 where o.id in (current_setting('test.renewal')::uuid,current_setting('test.canceled')::uuid,current_setting('test.future')::uuid,current_setting('test.conflict')::uuid);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select is(pg_temp.payment(current_setting('test.renewal')::uuid,'succeeded')->>'fulfillmentState','applied','оплата продлевает текущий интервал');
select is(pg_temp.payment(current_setting('test.renewal')::uuid,'succeeded')->>'fulfillmentState','applied','повтор успеха идемпотентен');
select is(pg_temp.payment(current_setting('test.renewal')::uuid,'pending')->>'fulfillmentState','applied','поздний pending не отменяет продление');
select is(pg_temp.payment(current_setting('test.canceled')::uuid,'pending')->>'fulfillmentState','not_paid','ожидание не продлевает');
select is(pg_temp.payment(current_setting('test.canceled')::uuid,'canceled')->>'fulfillmentState','not_paid','отказ не продлевает');
select is(pg_temp.payment(current_setting('test.future')::uuid,'succeeded')->>'fulfillmentState','deferred','следующий отдельный период отложен');
reset role;
select ok((select s.period_start=b.period_start and s.period_end=b.period_end+interval '30 days' and s.revision=b.revision+1
 from public.organization_subscriptions s join before_subscriptions b using(organization_id)
 where s.organization_id=(select organization_id from public.billing_sandbox_orders where id=current_setting('test.renewal')::uuid)),'сохраняется начало и ровно один раз растёт конец');
select is((select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.renewal')::uuid),1::bigint,'один receipt продления');
select ok((select to_jsonb(s)=to_jsonb(b) from public.organization_subscriptions s join before_subscriptions b using(organization_id)
 where s.organization_id=(select organization_id from public.billing_sandbox_orders where id=current_setting('test.canceled')::uuid)),'отказ сохраняет всю ранее оплаченную подписку');
select ok((select to_jsonb(s)=to_jsonb(b) from public.organization_subscriptions s join before_subscriptions b using(organization_id)
 where s.organization_id=(select organization_id from public.billing_sandbox_orders where id=current_setting('test.future')::uuid)),'будущая оплата не сокращает текущий период');
select is((select state from public.billing_sandbox_orders where id=current_setting('test.canceled')::uuid),'finished','отменённый заказ завершён');
select is((select count(*) from public.billing_period_confirmations where confirmation_id in(current_setting('test.canceled')::uuid,current_setting('test.future')::uuid)),0::bigint,'ни отказ, ни будущий период не получили receipt сейчас');
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=(select organization_id from public.billing_sandbox_orders where id=current_setting('test.conflict')::uuid);
set local role service_role;
select is(pg_temp.payment(current_setting('test.conflict')::uuid,'succeeded')->>'reason','revision_conflict','изменение условий после заказа требует сверки');
reset role;
select ok((select s.period_start=b.period_start and s.period_end=b.period_end and s.cancel_at_period_end
 from public.organization_subscriptions s join before_subscriptions b using(organization_id)
 where s.organization_id=(select organization_id from public.billing_sandbox_orders where id=current_setting('test.conflict')::uuid)),'конфликт не затирает оплаченный срок или решение пользователя');
-- Отдельный следующий период: реальная граница времени, без подмены часов БД.
insert into auth.users(id,email) values(md5('sandbox-renew-boundary')::uuid,'sandbox-renew-boundary@example.test');
select set_config('request.jwt.claim.sub',md5('sandbox-renew-boundary')::uuid::text,true);
select set_config('test.boundary_org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
insert into public.billing_sandbox_application_scope values(current_setting('test.boundary_org')::uuid);
select set_config('test.boundary_at',(clock_timestamp()+interval '3 seconds')::text,true);
select public.confirm_organization_subscription_period(current_setting('test.boundary_org')::uuid,gen_random_uuid(),0,
 (select id from public.billing_plan_versions where plan_key='pro' and version=1),now()-interval '1 day',current_setting('test.boundary_at')::timestamptz);
select set_config('test.boundary_order',public.reserve_sandbox_payment_order(current_setting('test.boundary_org')::uuid,gen_random_uuid(),1,
 (select id from public.billing_plan_versions where plan_key='pro' and version=1),100,'123','https://stage.qvesta.ru',
 current_setting('test.boundary_at')::timestamptz,current_setting('test.boundary_at')::timestamptz+interval '30 days')->>'id',true);
select public.begin_sandbox_payment_send(current_setting('test.boundary_order')::uuid);
set local role service_role;
select is(pg_temp.payment(current_setting('test.boundary_order')::uuid,'succeeded')->>'fulfillmentState','deferred','на границе будущий период сначала отложен');
select pg_sleep(greatest(0,extract(epoch from current_setting('test.boundary_at')::timestamptz-clock_timestamp()))+0.1);
select is(public.process_billing_confirmation(current_setting('test.boundary_order')::uuid)->>'state','applied','lifecycle применяет следующий период при наступлении срока');
select is(public.process_billing_confirmation(current_setting('test.boundary_order')::uuid)->>'state','applied','повтор lifecycle не выдаёт период заново');
select is(pg_temp.payment(current_setting('test.boundary_order')::uuid,'succeeded')->>'fulfillmentState','applied','платёжная сверка видит применённый lifecycle период');
reset role;
select is((select revision from public.organization_subscriptions where organization_id=current_setting('test.boundary_org')::uuid),2::bigint,'ровно одна новая revision после границы');
select is((select period_start from public.organization_subscriptions where organization_id=current_setting('test.boundary_org')::uuid),current_setting('test.boundary_at')::timestamptz,'начало следующего периода совпадает с концом предыдущего');
select is((select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.boundary_order')::uuid),1::bigint,'один receipt после lifecycle и сверки');
select is((select state from public.billing_sandbox_orders where id=current_setting('test.boundary_order')::uuid),'finished','сверка завершает заказ после наступления периода');
select * from finish();
rollback;
