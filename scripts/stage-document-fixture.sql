begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $fixture$
declare w uuid; prior public.billing_sandbox_offers%rowtype; subscription public.organization_subscriptions%rowtype; start_at timestamptz;
begin
 select id into strict w from public.organizations where name='sandbox-future-fast';
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=w) then raise exception 'existing sandbox scope required'; end if;
 select * into strict subscription from public.organization_subscriptions where organization_id=w;
 if exists(select 1 from public.billing_discount_checkouts c join public.billing_discount_reservations r on r.order_id=c.id where c.organization_id=w and r.state='reserved') then raise exception 'unfinished discount checkout: preserve and review'; end if;
 select * into strict prior from public.billing_sandbox_offers where organization_id=w order by created_at desc limit 1;
 if exists(select 1 from public.purchase_document_versions where status='published' and id not in ('stage-test-agreement-20260926','stage-test-payment-20260926')) then raise exception 'unexpected published documents'; end if;
 insert into public.purchase_document_versions(id,kind,body,status) values
 ('stage-test-agreement-20260926','agreement','Тестовое соглашение stage. Только проверка интерфейса и записи согласия. Юридически обязательного договора не создаёт. Реальные покупки и списания отсутствуют. Версия: stage-test-agreement-20260926.','published'),
 ('stage-test-payment-20260926','payment_terms','Тестовые условия оплаты stage. Проверяется создание и отмена sandbox-заказа без реальных денег. Это не публичная оферта и не условия коммерческой продажи. Версия: stage-test-payment-20260926.','published') on conflict(id) do nothing;
 insert into public.checkout_document_scope(organization_id) values(w) on conflict do nothing;
 start_at:=greatest(clock_timestamp()+interval '10 minutes',subscription.period_end);
 if not exists(select 1 from public.billing_sandbox_offers where id=md5('stage-documents-20260926')::uuid) then
 insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
 values(md5('stage-documents-20260926')::uuid,w,subscription.plan_version_id,subscription.revision,200,prior.shop_id,'https://stage.qvesta.ru/organization/billing',start_at,((start_at at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',clock_timestamp()+interval '1 day',1);
 end if;
end; $fixture$;
commit;
select 'stage_document_fixture_ready' as result;
