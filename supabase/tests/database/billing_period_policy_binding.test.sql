begin;
select no_plan();
insert into auth.users(id,email) values(md5('policy-binding-owner')::uuid,'policy-binding@example.test');
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=md5('policy-binding-owner')::uuid),true);
create function pg_temp.binding() returns jsonb language sql as $$select public.lock_organization_billing_policy(current_setting('test.org')::uuid)$$;
create function pg_temp.confirm(key text, ending timestamptz) returns jsonb language sql as $$
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,md5(key)::uuid,
(select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid),
(select id from public.billing_plan_versions where plan_key='pro' and version=1),now()-interval '10 days',ending) $$;
select is(pg_temp.binding()->>'binding_status','unbound','нет автоматического назначения');
select pg_temp.confirm('binding-first',clock_timestamp()+interval '2 seconds');
select is(pg_temp.binding()->>'binding_status','bound','назначена при подтверждении');
select is(pg_temp.binding()->>'policy_version','1','фиксируется версия');
select is((select lifecycle_policy_version from public.billing_period_confirmations where confirmation_id=md5('binding-first')::uuid),1,'версия в журнале');
select pg_sleep(2.1);
select is(pg_temp.binding()->>'phase','grace','grace независимо от scheduler');
select public.record_organization_subscription_expiration(current_setting('test.org')::uuid,(select revision from public.organization_subscriptions where organization_id=current_setting('test.org')::uuid));
select is(pg_temp.binding()->>'phase','grace','истечение сохраняет привязку');
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.binding()->>'phase','grace','отмена после истечения не теряет grace');
update public.organization_subscriptions set team_member_quota_enabled=true where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.binding()->>'phase','grace','настройки не меняют происхождение периода');
savepoint change_period;
update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.binding()->>'binding_status','unbound','изменение срока без подтверждения инвалидирует');
update public.organization_subscriptions set period_end=period_end-interval '1 day' where organization_id=current_setting('test.org')::uuid;
select is(pg_temp.binding()->>'binding_status','unbound','возврат дат не восстанавливает привязку');
rollback to change_period;
select is(pg_temp.binding()->>'phase','grace','rollback восстанавливает привязку атомарно');
savepoint renew;
select pg_temp.confirm('binding-second',now()+interval '29 days');
select is(pg_temp.binding()->>'confirmation_id',md5('binding-second')::uuid::text,'новое подтверждение заменяет привязку');
rollback to renew;
select is(pg_temp.binding()->>'confirmation_id',md5('binding-first')::uuid::text,'rollback не оставляет новую привязку');
select pg_temp.confirm('binding-second',now()+interval '29 days');
select public.confirm_organization_subscription_period(current_setting('test.org')::uuid,md5('binding-first')::uuid,
(select (request->>'revision')::bigint from public.billing_period_confirmations where confirmation_id=md5('binding-first')::uuid),
(select (request->>'plan')::uuid from public.billing_period_confirmations where confirmation_id=md5('binding-first')::uuid),
(select (request->>'start')::timestamptz from public.billing_period_confirmations where confirmation_id=md5('binding-first')::uuid),
(select (request->>'end')::timestamptz from public.billing_period_confirmations where confirmation_id=md5('binding-first')::uuid));
select is(pg_temp.binding()->>'confirmation_id',md5('binding-second')::uuid::text,'старый retry не откатывает привязку');
insert into public.billing_lifecycle_policy_versions(version,grace_hours,grace_after_cancellation) values(2,1,false);
select is(pg_temp.binding()->>'policy_version','1','новая версия не меняет ранее выданную');
select is(pg_temp.binding()->>'policy_enforced','false','enforcement не включён');
select set_config('request.jwt.claim.sub',md5('policy-binding-owner')::uuid::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.binding()$$,'42501',null,'клиент не вызывает внутреннюю блокировку');
select throws_ok($$select * from public.billing_period_policy_bindings$$,'42501',null,'привязки закрыты');
select throws_ok($$update public.billing_period_policy_bindings set valid=true$$,'42501',null,'владелец не переписывает привязку');
reset role;
set local role anon;
select throws_ok($$select pg_temp.binding()$$,'42501',null,'анонимный доступ закрыт');
reset role;
select ok((select relrowsecurity from pg_class where oid='public.billing_period_policy_bindings'::regclass),'RLS включён');
select * from finish();
rollback;
