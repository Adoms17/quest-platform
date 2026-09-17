begin;
select no_plan();
insert into auth.users(id,email) select md5('promotion-'||n)::uuid,'promotion-'||n||'@example.test' from generate_series(1,5)n;
create function pg_temp.org(n integer) returns uuid language sql as $$select id from public.organizations where personal_owner_id=md5('promotion-'||n)::uuid$$;
create function pg_temp.rev(n integer) returns bigint language sql as $$select revision from public.organization_subscriptions where organization_id=pg_temp.org(n)$$;
create function pg_temp.issue(n integer,c integer default 1) returns jsonb language sql as $$
 select public.issue_organization_promotion(pg_temp.org(n),(select id from public.billing_plan_versions where plan_key='business' and version=1),21,
 now()+interval '7 days',md5('operator')::uuid,md5('issue-'||n||'-'||c)::uuid)
$$;
create function pg_temp.redeem(n integer,code text,c integer default 1,r bigint default 0) returns jsonb language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',md5('promotion-'||n)::text,true);
 return public.redeem_organization_promotion(pg_temp.org(n),code,md5('redeem-'||c)::uuid,r);
end;$$;
select ok((select relrowsecurity from pg_class where oid='public.billing_promotions'::regclass),'промокоды защищены RLS');
select ok((select relrowsecurity from pg_class where oid='public.billing_promotion_commands'::regclass),'активации защищены RLS');
select ok((select relrowsecurity from pg_class where oid='public.billing_promotion_rate_limits'::regclass),'rate limit защищён RLS');
select set_config('test.promo1',pg_temp.issue(1)::text,true);
select ok((current_setting('test.promo1')::jsonb->>'code') ~ '^[0-9A-F]{32}$','случайный код 128 бит');
select is(pg_temp.issue(1)->>'already_issued','true','повтор выпуска не создаёт второй код');
select is(pg_temp.issue(1)->>'code',null,'код повторно не раскрывается');
select is((select count(*) from public.billing_promotions),1::bigint,'одна запись выпуска');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='billing_promotions' and column_name in ('code','raw_code')),'сырой код не хранится');
select throws_ok($$select public.issue_organization_promotion(pg_temp.org(2),(select id from public.billing_plan_versions where plan_key='business' and version=1),21,now()+interval '7 days',md5('operator')::uuid,md5('issue-1-1')::uuid)$$,'22023','promotion issue conflict','смена организации при retry выпуска запрещена');
select throws_ok($$select public.issue_organization_promotion(pg_temp.org(2),(select id from public.billing_plan_versions where plan_key='free' and version=1),21,now()+interval '7 days',md5('operator')::uuid,gen_random_uuid())$$,'22023','invalid promotion issue','Free не является платным промотарифом');
select is(pg_temp.redeem(2,current_setting('test.promo1')::jsonb->>'code')->>'reason','invalid_code','чужой организации код недоступен');
select is(pg_temp.redeem(1,current_setting('test.promo1')::jsonb->>'code',2,99)->>'reason','revision_conflict','старый экран не меняет подписку');
select is((select redeemed_access_id from public.billing_promotions where id=(current_setting('test.promo1')::jsonb->>'promotion_id')::uuid),null::uuid,'отказ не расходует код');
select set_config('test.receipt1',pg_temp.redeem(1,lower(current_setting('test.promo1')::jsonb->>'code'))::text,true);
select is(current_setting('test.receipt1')::jsonb->>'ok','true','код активирован');
select is(current_setting('test.receipt1')::jsonb->>'access_kind','promotion','промодоступ отличим от trial');
select is((select period_end-period_start from public.organization_subscriptions where organization_id=pg_temp.org(1)),interval '504 hours','выданы выбранные 21 сутки');
select is((select count(*) from public.billing_trial_usage),0::bigint,'промокод не расходует trial');
select is(pg_temp.redeem(1,current_setting('test.promo1')::jsonb->>'code'),current_setting('test.receipt1')::jsonb,'retry возвращает прежний receipt');
select is((select attempts from public.billing_promotion_rate_limits where actor_id=md5('promotion-1')::uuid),2,'retry не увеличивает счётчик');
select is(pg_temp.redeem(1,current_setting('test.promo1')::jsonb->>'code',3,pg_temp.rev(1))->>'reason','invalid_code','новая команда не использует код повторно');
select throws_ok($$select public.revoke_organization_promotion((current_setting('test.promo1')::jsonb->>'promotion_id')::uuid)$$,'P0001','promotion already redeemed','отзыв не отнимает выданный доступ');
select set_config('test.promo1next',pg_temp.issue(1,2)::text,true);
select is(pg_temp.redeem(1,current_setting('test.promo1next')::jsonb->>'code',4,pg_temp.rev(1))->>'reason','access_conflict','периоды не суммируются');
select set_config('request.jwt.claim.sub',md5('promotion-1')::text,true);
select throws_ok($$select public.request_organization_trial(pg_temp.org(1),(select id from public.billing_plan_versions where plan_key='pro' and version=1),repeat('b',64),gen_random_uuid(),pg_temp.rev(1))$$,'P0001','trial already pending','trial не накладывается на промодоступ');

-- Граница и повторная промоакция после окончания прежней.
select is((select public.resolve_subscription_quota_phase(s,s.period_end)->>'phase' from public.organization_subscriptions s where organization_id=pg_temp.org(1)),'free','промодоступ заканчивается на Free без grace');
update public.billing_trial_access set starts_at=now()-interval '22 days',ends_at=now()-interval '1 day' where organization_id=pg_temp.org(1);
update public.organization_subscriptions s set period_start=g.starts_at,period_end=g.ends_at from public.billing_trial_access g where g.id=s.trial_access_id and s.organization_id=pg_temp.org(1);
select is(pg_temp.redeem(1,current_setting('test.promo1next')::jsonb->>'code',5,pg_temp.rev(1))->>'ok','true','новый код после окончания старого без ожидания cron');
select is((select count(*) from public.billing_trial_usage),0::bigint,'повторная промоакция не меняет trial-историю');

-- Истёкший/отозванный код и сохранение счётчика отказов.
select set_config('test.promo2',pg_temp.issue(2)::text,true);
select lives_ok($$select public.revoke_organization_promotion((current_setting('test.promo2')::jsonb->>'promotion_id')::uuid)$$,'отзыв неиспользованного кода');
select lives_ok($$select public.revoke_organization_promotion((current_setting('test.promo2')::jsonb->>'promotion_id')::uuid)$$,'retry отзыва безопасен');
select is(pg_temp.redeem(2,current_setting('test.promo2')::jsonb->>'code',2)->>'reason','invalid_code','отозванный код не работает');
select set_config('test.promo3',pg_temp.issue(3)::text,true);
update public.billing_promotions set activate_before=now() where organization_id=pg_temp.org(3);
select is(pg_temp.redeem(3,current_setting('test.promo3')::jsonb->>'code')->>'reason','invalid_code','точная граница срока активации');
select is((select attempts from public.billing_promotion_rate_limits where actor_id=md5('promotion-3')::uuid),1,'отказ сохранён без exception');
do $$begin for i in 2..10 loop perform pg_temp.redeem(3,'invalid',i); end loop; end;$$;
select is(pg_temp.redeem(3,'invalid',11)->>'reason','rate_limited','одиннадцатая проверка ограничена');
select is((select attempts from public.billing_promotion_rate_limits where actor_id=md5('promotion-3')::uuid),10,'счётчик не растёт бесконечно');
update public.billing_promotion_rate_limits set window_start=now()-interval '16 minutes' where actor_id=md5('promotion-3')::uuid;
select is(pg_temp.redeem(3,'invalid',12)->>'reason','invalid_code','после окна проверки доступны снова');

-- Оплаченный период сохранён; после конфликта повторное согласование не меняет длительность.
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),period_start=now()-interval '1 day',period_end=now()+interval '4 days' where organization_id=pg_temp.org(4);
select set_config('test.promo4',pg_temp.issue(4)::text,true);
select is(pg_temp.redeem(4,current_setting('test.promo4')::jsonb->>'code',1,pg_temp.rev(4))->>'state','scheduled','доступ запланирован после оплаты');
select is((select status from public.organization_subscriptions where organization_id=pg_temp.org(4)),'active','оплаченный статус сохранён');
update public.organization_subscriptions set period_end=period_end+interval '30 days' where organization_id=pg_temp.org(4);
select is(public.advance_organization_trial(pg_temp.org(4))->>'outcome','review','новая оплата требует согласования промопериода');
select set_config('request.jwt.claim.sub',md5('promotion-4')::text,true);
select lives_ok($$select public.reconfirm_organization_trial(pg_temp.org(4),(select redeemed_access_id from public.billing_promotions where organization_id=pg_temp.org(4)),gen_random_uuid(),pg_temp.rev(4))$$,'общий механизм повторного согласования');
select is((select ends_at-starts_at from public.billing_trial_access where organization_id=pg_temp.org(4)),interval '504 hours','срок промокода сохранён после переноса');

set local role authenticated;
select throws_ok($$select * from public.billing_promotions$$,'42501',null,'каталог и хеши закрыты');
select throws_ok($$select * from public.billing_promotion_commands$$,'42501',null,'журнал закрыт');
select throws_ok($$select * from public.billing_promotion_rate_limits$$,'42501',null,'счётчик закрыт');
reset role;
select ok(not has_function_privilege('authenticated','public.issue_organization_promotion(uuid,uuid,integer,timestamptz,uuid,uuid)','execute'),'billing.manage не даёт выпуск кодов');
select ok(has_function_privilege('authenticated','public.redeem_organization_promotion(uuid,text,uuid,bigint)','execute'),'клиентская активация открыта через защищённую команду');
select * from finish();
rollback;
