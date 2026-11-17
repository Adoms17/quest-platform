begin;
select no_plan();
insert into auth.users(id,email) values(md5('binding-owner')::uuid,'binding-owner@example.test');
select set_config('test.binding_org',(select id::text from public.organizations where personal_owner_id=md5('binding-owner')::uuid),true);
select set_config('test.binding_pro',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
select set_config('test.binding_free',(select id::text from public.billing_plan_versions where plan_key='free' and version=1),true);
update public.organization_subscriptions set status='active',plan_version_id=current_setting('test.binding_pro')::uuid,
  period_start=now()-interval '1 day',period_end=now()+interval '29 days' where organization_id=current_setting('test.binding_org')::uuid;
select set_config('request.jwt.claim.sub',md5('binding-owner')::uuid::text,true);
set local role authenticated;
select lives_ok($$select public.request_organization_billing_intent(current_setting('test.binding_org')::uuid,md5('binding-schedule')::uuid,1,'schedule_downgrade',current_setting('test.binding_free')::uuid)$$,'schedule captures source');
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','scheduled','matching source scheduled');
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_source_plan_version_id',current_setting('test.binding_pro'),'captures original plan');
reset role;
update public.organization_subscriptions set period_end=period_end+interval '1 month' where organization_id=current_setting('test.binding_org')::uuid;
set local role authenticated;
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','stale','extension makes old intent stale');
select throws_ok($$select public.request_organization_billing_intent(current_setting('test.binding_org')::uuid,md5('binding-old-revision')::uuid,2,'clear_downgrade')$$,'40001','billing revision conflict','old UI cannot clear newer state');
reset role;
update public.organization_subscriptions set period_end=period_end-interval '1 month' where organization_id=current_setting('test.binding_org')::uuid;
set local role authenticated;
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','stale','restoring old period does not revive intent');
select lives_ok($$select public.request_organization_billing_intent(current_setting('test.binding_org')::uuid,md5('binding-clear')::uuid,4,'clear_downgrade')$$,'explicit clear');
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','none','clear removes snapshot');
select lives_ok($$select public.request_organization_billing_intent(current_setting('test.binding_org')::uuid,md5('binding-new')::uuid,5,'schedule_downgrade',current_setting('test.binding_free')::uuid)$$,'fresh request binds again');
reset role;
update public.organization_subscriptions set plan_version_id=(select id from public.billing_plan_versions where plan_key='business' and version=1)
  where organization_id=current_setting('test.binding_org')::uuid;
set local role authenticated;
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','stale','plan change invalidates schedule');
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_source_plan_version_id',current_setting('test.binding_pro'),'original plan snapshot preserved');
reset role;
-- Серверная фикстура моделирует наступивший срок без изменения снимка.
update public.organization_subscriptions set scheduled_plan_version_id=null,scheduled_effective_at=null where organization_id=current_setting('test.binding_org')::uuid;
update public.organization_subscriptions set status='active',plan_version_id=current_setting('test.binding_pro')::uuid,
  period_start=now()-interval '2 days',period_end=now()-interval '1 day' where organization_id=current_setting('test.binding_org')::uuid;
update public.organization_subscriptions set scheduled_plan_version_id=current_setting('test.binding_free')::uuid,scheduled_effective_at=period_end where organization_id=current_setting('test.binding_org')::uuid;
set local role authenticated;
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','due','elapsed matching period is due');
reset role;
select is((select plan_version_id::text from public.organization_subscriptions where organization_id=current_setting('test.binding_org')::uuid),current_setting('test.binding_pro'),'due does not apply downgrade');
update public.organization_subscriptions set status='expired' where organization_id=current_setting('test.binding_org')::uuid;
set local role authenticated;
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','due','expired status keeps matching source');
reset role;
-- Только синтетическая строка внутри откатываемого теста: старое намерение без снимка.
delete from public.organization_subscriptions where organization_id=current_setting('test.binding_org')::uuid;
insert into public.organization_subscriptions(organization_id,status,plan_version_id,period_start,period_end,scheduled_plan_version_id,scheduled_effective_at)
values(current_setting('test.binding_org')::uuid,'active',current_setting('test.binding_pro')::uuid,now()-interval '2 days',now()-interval '1 day',current_setting('test.binding_free')::uuid,now()-interval '1 day');
set local role authenticated;
select is(public.get_organization_billing_intent(current_setting('test.binding_org')::uuid)->>'scheduled_intent_state','stale','missing source is never due');
select * from finish();
rollback;
