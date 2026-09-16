begin;
select no_plan();
insert into auth.users(id,email) select md5('trial-life-'||n)::uuid,'trial-life-'||n||'@example.test' from generate_series(1,6)n;
create function pg_temp.org(n integer) returns uuid language sql as $$select id from public.organizations where personal_owner_id=md5('trial-life-'||n)::uuid$$;
create function pg_temp.plan(k text) returns uuid language sql as $$select id from public.billing_plan_versions where plan_key=k and version=1$$;
create function pg_temp.request(n integer,k text default 'pro',c integer default 1,d integer default 1,r bigint default 0)
returns jsonb language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',md5('trial-life-'||n)::text,true);
 return public.request_organization_trial(pg_temp.org(n),pg_temp.plan(k),lpad(d::text,64,'0'),md5('trial-command-'||c)::uuid,r);
end;$$;
select ok(has_function_privilege('authenticated','public.request_organization_trial(uuid,uuid,text,uuid,bigint)','execute'),'активация открыта через защищённую команду');
select ok((select relrowsecurity from pg_class where oid='public.billing_trial_access'::regclass),'доступы защищены RLS');
select ok((select relrowsecurity from pg_class where oid='public.billing_trial_transitions'::regclass),'аудит защищён RLS');
select throws_ok($$select pg_temp.request(1,'free')$$,'22023','trial requires a paid plan','Free нельзя активировать как trial');
select throws_ok($$select pg_temp.request(1,'pro',1,1,99)$$,'40001','billing revision conflict','устаревшее подтверждение отклонено');
select is((select count(*) from public.billing_trial_usage),0::bigint,'ошибка не расходует trial');
select set_config('test.trial.receipt',pg_temp.request(1)::text,true);
select is((current_setting('test.trial.receipt')::jsonb)->>'state','active','trial начинается при подтверждении без оплаты');
select is(pg_temp.request(1),current_setting('test.trial.receipt')::jsonb,'повтор команды возвращает тот же receipt');
select is((select count(*) from public.billing_trial_usage),1::bigint,'повтор не расходует право дважды');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(1)),'trial','подписка активирована');
select is((select period_end-period_start from public.organization_subscriptions where organization_id=pg_temp.org(1)),interval '336 hours','ровно 14 суток');
select ok((select not active_quest_quota_enabled and not team_member_quota_enabled and not quest_start_enforcement_enabled from public.organization_subscriptions where organization_id=pg_temp.org(1)),'флаги не включаются автоматически');
select throws_ok($$select pg_temp.request(1,'business')$$,'22023','trial command conflict','другой payload с тем же ключом запрещён');
select throws_ok($$select pg_temp.request(2)$$,'P0001','trial already used','известный браузер блокирует другой аккаунт');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(2)),'unconfigured','неудачная активация не меняет подписку');

-- Точные границы вычисляются без ожидания cron и без клиентского времени.
select is((select (public.resolve_subscription_quota_phase(s,s.period_end-interval '1 microsecond'))->>'phase' from public.organization_subscriptions s where organization_id=pg_temp.org(1)),'trial','до конца действует trial');
select is((select (public.resolve_subscription_quota_phase(s,s.period_end))->>'phase' from public.organization_subscriptions s where organization_id=pg_temp.org(1)),'free','на границе действует Free без grace');
select is((select (public.resolve_subscription_quota_phase(s,s.period_end))->>'effective_plan_version_id' from public.organization_subscriptions s where organization_id=pg_temp.org(1)),pg_temp.plan('free')::text,'на границе квоты Free');

-- Смещаем тестовый период в прошлое согласованно: моделируем задержанный runner.
update public.billing_trial_access set starts_at=now()-interval '15 days',ends_at=now()-interval '1 day' where organization_id=pg_temp.org(1);
update public.organization_subscriptions s set period_start=g.starts_at,period_end=g.ends_at from public.billing_trial_access g where s.organization_id=pg_temp.org(1) and g.id=s.trial_access_id;
select set_config('request.jwt.claim.sub',md5('trial-life-1')::text,true);
select is(public.get_organization_billing_state(pg_temp.org(1))->>'status','free','кабинет видит Free до runner');
select is(public.get_organization_billing_state(pg_temp.org(1))->>'stored_status','trial','сохранённый статус отличается от эффективного до runner');
select is(public.get_organization_billing_state(pg_temp.org(1))->'effective_entitlements'->>'active_quests','1','кабинет не оставляет платные квоты');
update public.organization_subscriptions set active_quest_quota_enabled=true where organization_id=pg_temp.org(1);
select lives_ok($$insert into public.quests(creator_id,organization_id,title,is_open,is_public) values(md5('trial-life-1')::uuid,pg_temp.org(1),'First',true,true)$$,'первый слот Free до runner');
select throws_ok($$insert into public.quests(creator_id,organization_id,title,is_open,is_public) values(md5('trial-life-1')::uuid,pg_temp.org(1),'Second',true,true)$$,'P0001','active quest quota exceeded','квоты Free до runner');
select is(public.advance_organization_trial(pg_temp.org(1))->>'outcome','finished','runner фиксирует Free');
select is(public.advance_organization_trial(pg_temp.org(1))->>'changed','false','повтор окончания безопасен');
select is((select count(*) from public.quests where organization_id=pg_temp.org(1)),1::bigint,'квесты сохранены');
select is(pg_temp.request(1),current_setting('test.trial.receipt')::jsonb,'старый retry после окончания не перезапускает trial');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(1)),'free','старый receipt не возобновляет trial');
select throws_ok($$select pg_temp.request(1,'pro',2,1,(select revision from public.organization_subscriptions where organization_id=pg_temp.org(1)))$$,'P0001','trial already used','новая команда не повторяет использованный тариф');

-- Запланированный trial сохраняет оплаченные даты.
update public.organization_subscriptions set status='active',plan_version_id=pg_temp.plan('pro'),period_start=now()-interval '1 day',period_end=now()+interval '2 days' where organization_id in (pg_temp.org(3),pg_temp.org(4));
select is(pg_temp.request(3,'business',1,3,1)->>'state','scheduled','trial после оплаченного периода');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(3)),'active','оплата не заменена trial');
select is((select g.starts_at=s.period_end from public.billing_trial_access g join public.organization_subscriptions s using(organization_id) where s.organization_id=pg_temp.org(3)),true,'начало на оплаченной границе');
select is((select (public.resolve_subscription_quota_phase(s,s.period_end))->>'phase' from public.organization_subscriptions s where organization_id=pg_temp.org(3)),'trial','на границе виртуально начинается trial');
select throws_ok($$update public.organization_subscriptions set cancel_at_period_end=true where organization_id=pg_temp.org(3)$$,'P0001','trial billing intent conflict','конкурирующее намерение не накладывается молча');
select is(pg_temp.request(4,'business',1,4,1)->>'state','scheduled','вторая организация планирует trial');
-- Новое подтверждение оплаты меняет даты: прежняя привязка не восстанавливается.
update public.organization_subscriptions set period_end=period_end+interval '30 days' where organization_id=pg_temp.org(4);
select is(public.advance_organization_trial(pg_temp.org(4))->>'outcome','review','новый платный период приостанавливает trial');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(4)),'active','новая оплата сохранена');
select is((select trial_access_id is null from public.organization_subscriptions where organization_id=pg_temp.org(4)),true,'устаревшая привязка снята');
select throws_ok($$select pg_temp.request(4,'business',2,4,(select revision from public.organization_subscriptions where organization_id=pg_temp.org(4)))$$,'P0001','trial already pending','проверку нельзя обойти повторной активацией');
select lives_ok($$select public.run_billing_lifecycle(100)$$,'общий runner совместим');
update public.billing_trial_access set starts_at=now()-interval '1 day',ends_at=now()+interval '13 days',
 source_state=source_state||jsonb_build_object('period_start',now()-interval '10 days','period_end',now()-interval '1 day') where organization_id=pg_temp.org(3);
update public.organization_subscriptions set period_start=now()-interval '10 days',period_end=now()-interval '1 day' where organization_id=pg_temp.org(3);
select lives_ok($$select public.run_billing_lifecycle(100)$$,'runner начинает отложенный trial после технического истечения оплаты');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(3)),'trial','отложенный trial записан');
select is((select state from public.billing_trial_access where organization_id=pg_temp.org(3)),'active','состояние доступа обновлено');
select ok((select not active from cron.job where jobname='quest-billing-lifecycle'),'расписание не включено');

select set_config('request.jwt.claim.sub',md5('trial-life-5')::text,true);
select throws_ok($$select public.request_organization_trial(pg_temp.org(6),pg_temp.plan('pro'),repeat('a',64),gen_random_uuid(),0)$$,'42501','billing management denied','чужую организацию нельзя активировать');
set local role authenticated;
select throws_ok($$select * from public.billing_trial_access$$,'42501',null,'чужие заявки и метки закрыты');
select throws_ok($$select * from public.billing_trial_transitions$$,'42501',null,'прямое чтение аудита закрыто');
reset role;
select * from finish();
rollback;
