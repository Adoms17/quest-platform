begin;
select no_plan();
insert into auth.users(id,email) select md5('review-'||n)::uuid,'review-'||n||'@example.test' from generate_series(1,2) n;
update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),period_start=now()-interval '2 days',period_end=now()-interval '1 day'
where organization_id in(select id from public.organizations where personal_owner_id in(md5('review-1')::uuid,md5('review-2')::uuid));
select public.enqueue_billing_confirmation(o.id,md5('review-event-'||n)::uuid,1,(select id from public.billing_plan_versions where plan_key='pro' and version=1),now()-interval '2 days',now()+interval '29 days')
from generate_series(1,2) n join public.organizations o on o.personal_owner_id=md5('review-'||n)::uuid;
select public.record_organization_subscription_expiration(id,1) from public.organizations where personal_owner_id in(md5('review-1')::uuid,md5('review-2')::uuid);
-- Фикстура review, сохранённого старым обработчиком до исправления гонки.
update public.billing_confirmation_inbox set state='review',reason='revision_conflict' where confirmation_id in(md5('review-event-1')::uuid,md5('review-event-2')::uuid);
savepoint review_rollback;
set local role service_role;
select lives_ok($$select public.recheck_expiration_billing_review(md5('review-event-1')::uuid)$$,'eligible review applied');
reset role;
rollback to review_rollback;
select is((select state from public.billing_confirmation_inbox where confirmation_id=md5('review-event-1')::uuid),'review','rollback restores review');
select is((select count(*)::int from public.billing_review_resolutions where confirmation_id=md5('review-event-1')::uuid),0,'rollback removes audit');
select set_config('test.review_receipt',public.recheck_expiration_billing_review(md5('review-event-1')::uuid)::text,true);
select is(public.recheck_expiration_billing_review(md5('review-event-1')::uuid),current_setting('test.review_receipt')::jsonb,'retry exact');
select is((select before_state->>'reason' from public.billing_review_resolutions where confirmation_id=md5('review-event-1')::uuid),'revision_conflict','previous reason retained');
select is((select expected_revision from public.billing_confirmation_inbox where confirmation_id=md5('review-event-1')::uuid),1::bigint,'original revision retained');
update public.organization_subscriptions set cancel_at_period_end=true where organization_id=(select id from public.organizations where personal_owner_id=md5('review-2')::uuid);
select throws_ok($$select public.recheck_expiration_billing_review(md5('review-event-2')::uuid)$$,'40001','billing review evidence mismatch','other changes block resolution');
select is((select state from public.billing_confirmation_inbox where confirmation_id=md5('review-event-2')::uuid),'review','failure preserves queue item');
update public.billing_confirmation_inbox set reason='elapsed_period' where confirmation_id=md5('review-event-2')::uuid;
select throws_ok($$select public.recheck_expiration_billing_review(md5('review-event-2')::uuid)$$,'22023','billing review not eligible','other reasons not reset');
set local role authenticated;
select throws_ok($$select public.recheck_expiration_billing_review(md5('review-event-1')::uuid)$$,'42501',null,'client denied');
select throws_ok($$select * from public.billing_review_resolutions$$,'42501',null,'audit closed');
set local role anon;
select throws_ok($$select public.recheck_expiration_billing_review(md5('review-event-1')::uuid)$$,'42501',null,'anon denied');
reset role;
select * from finish();
rollback;
