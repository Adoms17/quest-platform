begin;
select no_plan();
insert into auth.users(id,email) values(md5('trial-review')::uuid,'trial-review@example.test');
create function pg_temp.org() returns uuid language sql as $$select id from public.organizations where personal_owner_id=md5('trial-review')::uuid$$;
create function pg_temp.rev() returns bigint language sql as $$select revision from public.organization_subscriptions where organization_id=pg_temp.org()$$;
create function pg_temp.access_id() returns uuid language sql as $$select id from public.billing_trial_access where organization_id=pg_temp.org()$$;
select set_config('request.jwt.claim.sub',md5('trial-review')::text,true);
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
 period_start=now()-interval '1 day',period_end=now()+interval '2 days' where organization_id=pg_temp.org();
select lives_ok($$select public.request_organization_trial(pg_temp.org(),(select id from public.billing_plan_versions where plan_key='business' and version=1),repeat('d',64),md5('initial')::uuid,pg_temp.rev())$$,'планируем trial');
update public.organization_subscriptions set period_end=period_end+interval '30 days' where organization_id=pg_temp.org();
select is(public.get_organization_free_access_controls(pg_temp.org(),repeat('d',64))->'current_access'->>'state','review','кабинет видит необходимость согласования до runner');
select is((select state from public.billing_trial_access where id=pg_temp.access_id()),'scheduled','runner ещё не фиксировал конфликт');
select set_config('test.review.rev',pg_temp.rev()::text,true);
select throws_ok($$select public.reconfirm_organization_trial(pg_temp.org(),pg_temp.access_id(),md5('initial')::uuid,pg_temp.rev())$$,'22023','trial command conflict','ключ первоначальной команды не переиспользуется');
select set_config('test.review.receipt',public.reconfirm_organization_trial(pg_temp.org(),pg_temp.access_id(),md5('review1')::uuid,pg_temp.rev())::text,true);
select is(current_setting('test.review.receipt')::jsonb->>'state','scheduled','повторное согласование планирует после нового оплаченного срока');
select is(public.reconfirm_organization_trial(pg_temp.org(),pg_temp.access_id(),md5('review1')::uuid,current_setting('test.review.rev')::bigint),current_setting('test.review.receipt')::jsonb,'повтор команды идемпотентен');
select is((select count(*) from public.billing_trial_usage where organization_id=pg_temp.org()),1::bigint,'не создаётся второе использование trial');
select is((select g.starts_at=s.period_end from public.billing_trial_access g join public.organization_subscriptions s using(organization_id) where s.organization_id=pg_temp.org()),true,'оплаченные дни не потеряны');
select is((select generation from public.billing_trial_access where id=pg_temp.access_id()),1,'поколение расписания сохранено');
select is((select count(*) from public.billing_trial_transitions where access_id=pg_temp.access_id() and kind='review'),1::bigint,'команда сама фиксирует конфликт в аудите');
select throws_ok($$select public.request_organization_trial(pg_temp.org(),(select id from public.billing_plan_versions where plan_key='pro' and version=1),repeat('d',64),md5('review1')::uuid,pg_temp.rev())$$,'22023','trial command conflict','ключ согласования не открывает новый trial');

-- Повторный конфликт тоже сохраняет отдельную запись аудита.
update public.organization_subscriptions set period_end=period_end+interval '30 days' where organization_id=pg_temp.org();
select is(public.advance_organization_trial(pg_temp.org())->>'outcome','review','повторное продление снова требует согласования');
select is((select count(*) from public.billing_trial_transitions where access_id=pg_temp.access_id() and kind='review'),2::bigint,'два конфликта не теряются в аудите');
select lives_ok($$select public.reconfirm_organization_trial(pg_temp.org(),pg_temp.access_id(),md5('review2')::uuid,pg_temp.rev())$$,'ещё не начатый trial можно перенести после оплаты');

-- Trial уже наступил по времени, хотя cron не запускался. Оплата не даёт перезапуск.
update public.billing_trial_access set starts_at=now()-interval '1 day',ends_at=now()+interval '13 days',
 source_state=source_state||jsonb_build_object('period_start',now()-interval '10 days','period_end',now()-interval '1 day') where id=pg_temp.access_id();
update public.organization_subscriptions set period_start=now()-interval '10 days',period_end=now()-interval '1 day' where organization_id=pg_temp.org();
update public.organization_subscriptions set period_start=now(),period_end=now()+interval '30 days' where organization_id=pg_temp.org();
select is(public.advance_organization_trial(pg_temp.org())->>'outcome','finished','платёж после виртуального старта сохраняется, использованный trial закрывается');
select ok((select was_started from public.billing_trial_access where id=pg_temp.access_id()),'старт по времени учтён без runner');
select throws_ok($$select public.reconfirm_organization_trial(pg_temp.org(),pg_temp.access_id(),md5('review3')::uuid,pg_temp.rev())$$,'P0001','trial is not awaiting review','использованный trial не перезапускается на полную длительность');
select ok(has_function_privilege('authenticated','public.reconfirm_organization_trial(uuid,uuid,uuid,bigint)','execute'),'команда открыта через проверку billing.manage');
select ok((select relrowsecurity from pg_class where oid='public.billing_trial_reconfirmations'::regclass),'команды защищены RLS');
set local role authenticated;
select throws_ok($$select * from public.billing_trial_reconfirmations$$,'42501',null,'прямое чтение журнала закрыто');
reset role;
select * from finish();
rollback;
