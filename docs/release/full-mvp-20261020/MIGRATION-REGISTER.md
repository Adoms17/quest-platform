# Реестр 228 миграций

Источник: `6a654dc5738ff0c81bf31616c50a2a6c167c3b11`. Все строки HOLD. Номер — исходный порядок, не разрешённый порядок применения. Полные хеши, операторы, зависимости и риски — в [JSON](migration-assessment.json); решения D1–D8 — в [оценке](MIGRATION-ASSESSMENT.md).

| № | Версия / файл | Фаза | Основная категория | Решения |
|---:|---|---|---|---|
| 1 | [20260915010000_add_billing_plan_versions](../../../supabase/migrations/20260915010000_add_billing_plan_versions.sql) | 01 | seed | D1, D2, D8, D3, D4 |
| 2 | [20260915020000_add_organization_subscriptions](../../../supabase/migrations/20260915020000_add_organization_subscriptions.sql) | 01 | backfill | D1, D2, D8, D3, D4 |
| 3 | [20260915030000_add_organization_billing_state](../../../supabase/migrations/20260915030000_add_organization_billing_state.sql) | 01 | функции | D1, D2, D8, D3 |
| 4 | [20260915040000_add_billing_period_resolution](../../../supabase/migrations/20260915040000_add_billing_period_resolution.sql) | 01 | schema | D1, D2, D8 |
| 5 | [20260915050000_require_finite_billing_periods](../../../supabase/migrations/20260915050000_require_finite_billing_periods.sql) | 01 | schema | D1, D2, D8 |
| 6 | [20260915060000_enforce_active_quest_quota](../../../supabase/migrations/20260915060000_enforce_active_quest_quota.sql) | 01 | schema | D1, D2, D8, D3 |
| 7 | [20260915070000_expose_active_quota_state](../../../supabase/migrations/20260915070000_expose_active_quota_state.sql) | 01 | функции | D1, D2, D8 |
| 8 | [20260915080000_add_organization_billing_overview](../../../supabase/migrations/20260915080000_add_organization_billing_overview.sql) | 01 | функции | D1, D2, D8, D3 |
| 9 | [20260915090000_enforce_team_member_quota](../../../supabase/migrations/20260915090000_enforce_team_member_quota.sql) | 01 | schema | D1, D2, D8, D3 |
| 10 | [20260915100000_expose_team_quota_state](../../../supabase/migrations/20260915100000_expose_team_quota_state.sql) | 01 | функции | D1, D2, D8, D3 |
| 11 | [20260915110000_record_participant_usage](../../../supabase/migrations/20260915110000_record_participant_usage.sql) | 01 | schema | D1, D2, D8, D3 |
| 12 | [20260915120000_read_monthly_participant_usage](../../../supabase/migrations/20260915120000_read_monthly_participant_usage.sql) | 01 | seed | D1, D2, D8, D3, D4 |
| 13 | [20260915130000_register_offline_attempt_identity](../../../supabase/migrations/20260915130000_register_offline_attempt_identity.sql) | 01 | schema | D1, D2, D8, D3 |
| 14 | [20260915140000_adopt_registered_offline_attempt](../../../supabase/migrations/20260915140000_adopt_registered_offline_attempt.sql) | 01 | функции | D1, D2, D8, D3 |
| 15 | [20260915150000_merge_participant_usage_identity](../../../supabase/migrations/20260915150000_merge_participant_usage_identity.sql) | 01 | schema | D1, D2, D8, D3 |
| 16 | [20260915160000_add_idempotent_quest_creation](../../../supabase/migrations/20260915160000_add_idempotent_quest_creation.sql) | 01 | schema | D1, D2, D8, D3 |
| 17 | [20260915170000_add_billing_intents](../../../supabase/migrations/20260915170000_add_billing_intents.sql) | 01 | schema | D1, D2, D8, D3 |
| 18 | [20260915180000_bind_scheduled_billing_intent](../../../supabase/migrations/20260915180000_bind_scheduled_billing_intent.sql) | 01 | backfill | D1, D2, D8, D3, D4 |
| 19 | [20260915190000_audit_due_billing_intents](../../../supabase/migrations/20260915190000_audit_due_billing_intents.sql) | 01 | schema | D1, D2, D8, D3 |
| 20 | [20260915200000_bind_cancel_billing_intent](../../../supabase/migrations/20260915200000_bind_cancel_billing_intent.sql) | 01 | backfill | D1, D2, D8, D3, D4 |
| 21 | [20260915210000_evaluate_cancel_billing_intent](../../../supabase/migrations/20260915210000_evaluate_cancel_billing_intent.sql) | 01 | schema | D1, D2, D8, D3 |
| 22 | [20260915220000_read_billing_intent_controls](../../../supabase/migrations/20260915220000_read_billing_intent_controls.sql) | 01 | функции | D1, D2, D8, D3 |
| 23 | [20260915230000_record_subscription_expiration](../../../supabase/migrations/20260915230000_record_subscription_expiration.sql) | 01 | schema | D1, D2, D8, D3 |
| 24 | [20260915233000_batch_subscription_expiration](../../../supabase/migrations/20260915233000_batch_subscription_expiration.sql) | 01 | schema | D1, D2, D8, D3 |
| 25 | [20260915235000_confirm_subscription_period](../../../supabase/migrations/20260915235000_confirm_subscription_period.sql) | 01 | schema | D1, D2, D8, D3 |
| 26 | [20260915235500_queue_billing_confirmations](../../../supabase/migrations/20260915235500_queue_billing_confirmations.sql) | 01 | schema | D1, D2, D8, D3 |
| 27 | [20260915235900_process_confirmation_queue](../../../supabase/migrations/20260915235900_process_confirmation_queue.sql) | 01 | schema | D1, D2, D8, D3 |
| 28 | [20260916001000_reconcile_technical_expiration](../../../supabase/migrations/20260916001000_reconcile_technical_expiration.sql) | 01 | schema | D1, D2, D8, D3 |
| 29 | [20260916002000_recheck_expiration_review](../../../supabase/migrations/20260916002000_recheck_expiration_review.sql) | 01 | schema | D1, D2, D8, D3 |
| 30 | [20260916003000_add_grace_policy_preview](../../../supabase/migrations/20260916003000_add_grace_policy_preview.sql) | 01 | seed | D1, D2, D8, D3, D4 |
| 31 | [20260916004000_bind_confirmed_grace_policy](../../../supabase/migrations/20260916004000_bind_confirmed_grace_policy.sql) | 01 | schema | D1, D2, D8, D3 |
| 32 | [20260916005000_apply_grace_to_resource_quotas](../../../supabase/migrations/20260916005000_apply_grace_to_resource_quotas.sql) | 01 | функции | D1, D2, D8, D3 |
| 33 | [20260916006000_prepare_offline_start_permits](../../../supabase/migrations/20260916006000_prepare_offline_start_permits.sql) | 01 | schema | D1, D2, D8, D3 |
| 34 | [20260916007000_redeem_offline_start_permits](../../../supabase/migrations/20260916007000_redeem_offline_start_permits.sql) | 01 | функции | D1, D2, D8, D3 |
| 35 | [20260916008000_register_permitted_offline_attempt](../../../supabase/migrations/20260916008000_register_permitted_offline_attempt.sql) | 01 | schema | D1, D2, D8, D3 |
| 36 | [20260916009000_guard_legacy_permit_registration](../../../supabase/migrations/20260916009000_guard_legacy_permit_registration.sql) | 01 | schema | D1, D2, D8, D3 |
| 37 | [20260916010000_schedule_billing_lifecycle](../../../supabase/migrations/20260916010000_schedule_billing_lifecycle.sql) | 01 | cron | D1, D2, D8, D3, D5 |
| 38 | [20260916011000_apply_requested_free_downgrade](../../../supabase/migrations/20260916011000_apply_requested_free_downgrade.sql) | 01 | schema | D1, D2, D8, D3 |
| 39 | [20260916012000_preserve_closed_offline_events](../../../supabase/migrations/20260916012000_preserve_closed_offline_events.sql) | 01 | schema | D1, D2, D8, D3 |
| 40 | [20260916013000_guard_reviewed_offline_attempts](../../../supabase/migrations/20260916013000_guard_reviewed_offline_attempts.sql) | 01 | функции | D1, D2, D8 |
| 41 | [20260916014000_preserve_permits_on_profile_merge](../../../supabase/migrations/20260916014000_preserve_permits_on_profile_merge.sql) | 01 | schema | D1, D2, D8, D3 |
| 42 | [20260916015000_connect_offline_start_policy](../../../supabase/migrations/20260916015000_connect_offline_start_policy.sql) | 01 | schema | D1, D2, D8, D3 |
| 43 | [20260916016000_preserve_legacy_events_after_grace](../../../supabase/migrations/20260916016000_preserve_legacy_events_after_grace.sql) | 01 | функции | D1, D2, D8 |
| 44 | [20260916017000_expose_offline_start_requirement](../../../supabase/migrations/20260916017000_expose_offline_start_requirement.sql) | 01 | функции | D1, D2, D8 |
| 45 | [20260916018000_add_trial_usage_foundation](../../../supabase/migrations/20260916018000_add_trial_usage_foundation.sql) | 01 | schema | D1, D2, D8, D3 |
| 46 | [20260916019000_add_trial_lifecycle](../../../supabase/migrations/20260916019000_add_trial_lifecycle.sql) | 01 | schema | D1, D2, D8, D3 |
| 47 | [20260916020000_reconfirm_trial_schedule](../../../supabase/migrations/20260916020000_reconfirm_trial_schedule.sql) | 01 | backfill | D1, D2, D8, D3, D4 |
| 48 | [20260916021000_add_personal_promotions](../../../supabase/migrations/20260916021000_add_personal_promotions.sql) | 01 | backfill | D1, D2, D8, D3, D4 |
| 49 | [20260916022000_expose_free_access_controls](../../../supabase/migrations/20260916022000_expose_free_access_controls.sql) | 01 | функции | D1, D2, D8, D3 |
| 50 | [20260916023000_reconcile_free_access_before_reconfirmation](../../../supabase/migrations/20260916023000_reconcile_free_access_before_reconfirmation.sql) | 01 | функции | D1, D2, D8 |
| 51 | [20260916024000_reserve_sandbox_payment_orders](../../../supabase/migrations/20260916024000_reserve_sandbox_payment_orders.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 52 | [20260916025000_record_sandbox_payment_results](../../../supabase/migrations/20260916025000_record_sandbox_payment_results.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 53 | [20260916026000_add_sandbox_checkout_gateway](../../../supabase/migrations/20260916026000_add_sandbox_checkout_gateway.sql) | 01 | функции | D1, D2, D8, D3, D7 |
| 54 | [20260916027000_expose_sandbox_order_offer](../../../supabase/migrations/20260916027000_expose_sandbox_order_offer.sql) | 01 | функции | D1, D2, D8, D3, D7 |
| 55 | [20260916028000_find_pending_sandbox_order](../../../supabase/migrations/20260916028000_find_pending_sandbox_order.sql) | 01 | функции | D1, D2, D8, D3, D7 |
| 56 | [20260916029000_add_sandbox_checkout_offers](../../../supabase/migrations/20260916029000_add_sandbox_checkout_offers.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 57 | [20260916030000_recheck_sandbox_cancel_permission](../../../supabase/migrations/20260916030000_recheck_sandbox_cancel_permission.sql) | 01 | функции | D1, D2, D8, D7 |
| 58 | [20260916031000_add_sandbox_payment_inbox](../../../supabase/migrations/20260916031000_add_sandbox_payment_inbox.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 59 | [20260916032000_expose_sandbox_fulfillment_and_fence_jobs](../../../supabase/migrations/20260916032000_expose_sandbox_fulfillment_and_fence_jobs.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 60 | [20260916033000_expose_sandbox_payment_status](../../../supabase/migrations/20260916033000_expose_sandbox_payment_status.sql) | 01 | функции | D1, D2, D8, D3, D7 |
| 61 | [20260916034000_add_manual_sandbox_refunds](../../../supabase/migrations/20260916034000_add_manual_sandbox_refunds.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 62 | [20260916035000_expose_sandbox_refund_summary](../../../supabase/migrations/20260916035000_expose_sandbox_refund_summary.sql) | 01 | функции | D1, D2, D8, D3, D7 |
| 63 | [20260916036000_reconcile_sandbox_refunds](../../../supabase/migrations/20260916036000_reconcile_sandbox_refunds.sql) | 01 | функции | D1, D2, D8, D3, D7 |
| 64 | [20260917150000_archive_completion_limit_rejections](../../../supabase/migrations/20260917150000_archive_completion_limit_rejections.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 65 | [20260917160000_preserve_permit_conflicts](../../../supabase/migrations/20260917160000_preserve_permit_conflicts.sql) | 01 | schema | D1, D2, D8, D3, D7 |
| 66 | [20260918010000_add_platform_access_foundation](../../../supabase/migrations/20260918010000_add_platform_access_foundation.sql) | 02 | backfill | D1, D2, D8, D3, D4, D7 |
| 67 | [20260918020000_manage_platform_assignments](../../../supabase/migrations/20260918020000_manage_platform_assignments.sql) | 02 | schema | D1, D2, D8, D3, D7 |
| 68 | [20260918030000_bootstrap_platform_owner](../../../supabase/migrations/20260918030000_bootstrap_platform_owner.sql) | 02 | schema | D1, D2, D8, D3, D7 |
| 69 | [20260918040000_confirm_platform_commands](../../../supabase/migrations/20260918040000_confirm_platform_commands.sql) | 02 | schema | D1, D2, D8, D3, D7 |
| 70 | [20260918050000_register_platform_support_cases](../../../supabase/migrations/20260918050000_register_platform_support_cases.sql) | 02 | schema | D1, D2, D8, D3, D7 |
| 71 | [20260918060000_search_platform_organizations](../../../supabase/migrations/20260918060000_search_platform_organizations.sql) | 02 | schema | D1, D2, D8, D3, D7 |
| 72 | [20260918070000_log_platform_access_denials](../../../supabase/migrations/20260918070000_log_platform_access_denials.sql) | 02 | функции | D1, D2, D8, D3, D7 |
| 73 | [20260918080000_require_platform_command_reasons](../../../supabase/migrations/20260918080000_require_platform_command_reasons.sql) | 02 | schema | D1, D2, D8, D3, D7 |
| 74 | [20260919010000_read_platform_tariff_catalog](../../../supabase/migrations/20260919010000_read_platform_tariff_catalog.sql) | 03 | seed | D1, D2, D8, D3, D4, D7 |
| 75 | [20260919020000_add_platform_tariff_drafts](../../../supabase/migrations/20260919020000_add_platform_tariff_drafts.sql) | 03 | schema | D1, D2, D8, D3, D7 |
| 76 | [20260919030000_fix_platform_tariff_versions](../../../supabase/migrations/20260919030000_fix_platform_tariff_versions.sql) | 03 | schema | D1, D2, D8, D3, D7 |
| 77 | [20260919040000_scope_tariff_draft_lists](../../../supabase/migrations/20260919040000_scope_tariff_draft_lists.sql) | 03 | функции | D1, D2, D8, D3, D7 |
| 78 | [20260919050000_describe_tariff_drafts](../../../supabase/migrations/20260919050000_describe_tariff_drafts.sql) | 03 | schema | D1, D2, D8, D3, D7 |
| 79 | [20260919060000_enable_fixed_tariff_versions](../../../supabase/migrations/20260919060000_enable_fixed_tariff_versions.sql) | 03 | schema | D1, D2, D8, D3, D7 |
| 80 | [20260919070000_link_fixed_tariff_versions](../../../supabase/migrations/20260919070000_link_fixed_tariff_versions.sql) | 03 | функции | D1, D2, D8, D3, D7 |
| 81 | [20260920010000_add_tariff_timeline_foundation](../../../supabase/migrations/20260920010000_add_tariff_timeline_foundation.sql) | 04 | backfill | D1, D2, D8, D3, D4, D7 |
| 82 | [20260920020000_publish_and_revoke_tariff_versions](../../../supabase/migrations/20260920020000_publish_and_revoke_tariff_versions.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 83 | [20260920030000_select_current_manual_checkout](../../../supabase/migrations/20260920030000_select_current_manual_checkout.sql) | 04 | функции | D1, D2, D8, D7 |
| 84 | [20260920040000_select_trial_timeline](../../../supabase/migrations/20260920040000_select_trial_timeline.sql) | 04 | функции | D1, D2, D8, D7 |
| 85 | [20260920050000_preview_trial_purchase](../../../supabase/migrations/20260920050000_preview_trial_purchase.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 86 | [20260920060000_add_discount_code_foundation](../../../supabase/migrations/20260920060000_add_discount_code_foundation.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 87 | [20260920070000_issue_and_preview_discount_codes](../../../supabase/migrations/20260920070000_issue_and_preview_discount_codes.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 88 | [20260920080000_remove_legacy_promotions](../../../supabase/migrations/20260920080000_remove_legacy_promotions.sql) | 04 | schema | D1, D2, D8, D7 |
| 89 | [20260920090000_reserve_discount_periods](../../../supabase/migrations/20260920090000_reserve_discount_periods.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 90 | [20260920100000_preview_discount_checkout](../../../supabase/migrations/20260920100000_preview_discount_checkout.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 91 | [20260920110000_reserve_renewal_discount](../../../supabase/migrations/20260920110000_reserve_renewal_discount.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 92 | [20260920120000_accept_discount_checkout](../../../supabase/migrations/20260920120000_accept_discount_checkout.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 93 | [20260920130000_cancel_discount_checkout](../../../supabase/migrations/20260920130000_cancel_discount_checkout.sql) | 04 | backfill | D1, D2, D8, D3, D4, D7 |
| 94 | [20260920140000_fulfill_zero_discount_checkout](../../../supabase/migrations/20260920140000_fulfill_zero_discount_checkout.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 95 | [20260920150000_capture_trial_checkout_terms](../../../supabase/migrations/20260920150000_capture_trial_checkout_terms.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 96 | [20260920160000_replace_trial_zero_checkout](../../../supabase/migrations/20260920160000_replace_trial_zero_checkout.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 97 | [20260920170000_schedule_paid_period_after_trial](../../../supabase/migrations/20260920170000_schedule_paid_period_after_trial.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 98 | [20260920180000_prepare_discount_payment](../../../supabase/migrations/20260920180000_prepare_discount_payment.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 99 | [20260920190000_fulfill_discount_payment](../../../supabase/migrations/20260920190000_fulfill_discount_payment.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 100 | [20260920200000_fulfill_paid_trial_checkout](../../../supabase/migrations/20260920200000_fulfill_paid_trial_checkout.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 101 | [20260920210000_cancel_discount_payment](../../../supabase/migrations/20260920210000_cancel_discount_payment.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 102 | [20260920220000_expose_discount_order_summary](../../../supabase/migrations/20260920220000_expose_discount_order_summary.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 103 | [20260920230000_confirm_reviewed_discount_quote](../../../supabase/migrations/20260920230000_confirm_reviewed_discount_quote.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 104 | [20260920240000_preview_discount_trial_terms](../../../supabase/migrations/20260920240000_preview_discount_trial_terms.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 105 | [20260920250000_recover_and_cancel_discount_checkout](../../../supabase/migrations/20260920250000_recover_and_cancel_discount_checkout.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 106 | [20260920260000_expose_sandbox_discount_commands](../../../supabase/migrations/20260920260000_expose_sandbox_discount_commands.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 107 | [20260920270000_materialize_published_tariff_catalog](../../../supabase/migrations/20260920270000_materialize_published_tariff_catalog.sql) | 04 | backfill | D1, D2, D8, D4, D7 |
| 108 | [20260920280000_read_admin_tariff_timeline](../../../supabase/migrations/20260920280000_read_admin_tariff_timeline.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 109 | [20260920290000_align_admin_tariff_reads](../../../supabase/migrations/20260920290000_align_admin_tariff_reads.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 110 | [20260920300000_group_admin_tariff_catalog](../../../supabase/migrations/20260920300000_group_admin_tariff_catalog.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 111 | [20260920310000_filter_tariff_versions_descending](../../../supabase/migrations/20260920310000_filter_tariff_versions_descending.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 112 | [20260920320000_read_tariff_source_version](../../../supabase/migrations/20260920320000_read_tariff_source_version.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 113 | [20260920330000_preview_tariff_support_end](../../../supabase/migrations/20260920330000_preview_tariff_support_end.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 114 | [20260920340000_schedule_tariff_support_end](../../../supabase/migrations/20260920340000_schedule_tariff_support_end.sql) | 04 | функции | D1, D2, D8, D3, D7 |
| 115 | [20260921010000_allow_full_price_checkout](../../../supabase/migrations/20260921010000_allow_full_price_checkout.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 116 | [20260921020000_read_platform_discounts](../../../supabase/migrations/20260921020000_read_platform_discounts.sql) | 04 | seed | D1, D2, D8, D3, D4, D7 |
| 117 | [20260921030000_platform_discount_campaigns](../../../supabase/migrations/20260921030000_platform_discount_campaigns.sql) | 04 | seed | D1, D2, D8, D3, D4, D7 |
| 118 | [20260921040000_read_discount_campaigns](../../../supabase/migrations/20260921040000_read_discount_campaigns.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 119 | [20260921050000_issue_campaign_discount](../../../supabase/migrations/20260921050000_issue_campaign_discount.sql) | 04 | seed | D1, D2, D8, D3, D4, D7 |
| 120 | [20260921060000_global_campaign_catalog](../../../supabase/migrations/20260921060000_global_campaign_catalog.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 121 | [20260921070000_campaign_activation_windows](../../../supabase/migrations/20260921070000_campaign_activation_windows.sql) | 04 | schema | D1, D2, D8, D3, D7 |
| 122 | [20260922010000_read_platform_payments](../../../supabase/migrations/20260922010000_read_platform_payments.sql) | 05 | seed | D1, D2, D8, D3, D4, D7 |
| 123 | [20260922020000_preview_platform_refund](../../../supabase/migrations/20260922020000_preview_platform_refund.sql) | 05 | seed | D1, D2, D8, D3, D4, D7 |
| 124 | [20260922030000_confirm_platform_refund](../../../supabase/migrations/20260922030000_confirm_platform_refund.sql) | 05 | schema | D1, D2, D8, D3, D7 |
| 125 | [20260922040000_authorize_platform_refund_execution](../../../supabase/migrations/20260922040000_authorize_platform_refund_execution.sql) | 05 | функции | D1, D2, D8, D3, D7 |
| 126 | [20260922050000_platform_refund_gateway](../../../supabase/migrations/20260922050000_platform_refund_gateway.sql) | 05 | функции | D1, D2, D8, D3, D7 |
| 127 | [20260922060000_read_platform_refund_history](../../../supabase/migrations/20260922060000_read_platform_refund_history.sql) | 05 | функции | D1, D2, D8, D3, D7 |
| 128 | [20260922070000_validate_platform_refund_amount](../../../supabase/migrations/20260922070000_validate_platform_refund_amount.sql) | 05 | функции | D1, D2, D8, D3, D7 |
| 129 | [20260922080000_guard_paid_trial_checkout](../../../supabase/migrations/20260922080000_guard_paid_trial_checkout.sql) | 05 | функции | D1, D2, D8, D7 |
| 130 | [20260922090000_resolve_refunded_trial_duplicate](../../../supabase/migrations/20260922090000_resolve_refunded_trial_duplicate.sql) | 05 | schema | D1, D2, D8, D3, D7 |
| 131 | [20260922100000_recurring_consent_foundation](../../../supabase/migrations/20260922100000_recurring_consent_foundation.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 132 | [20260922110000_bind_recurring_method](../../../supabase/migrations/20260922110000_bind_recurring_method.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 133 | [20260922120000_recurring_send_snapshot](../../../supabase/migrations/20260922120000_recurring_send_snapshot.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 134 | [20260922130000_prepare_recurring_order](../../../supabase/migrations/20260922130000_prepare_recurring_order.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 135 | [20260922140000_release_recurring_reservation](../../../supabase/migrations/20260922140000_release_recurring_reservation.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 136 | [20260922150000_review_recurring_order](../../../supabase/migrations/20260922150000_review_recurring_order.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 137 | [20260922160000_begin_recurring_attempt](../../../supabase/migrations/20260922160000_begin_recurring_attempt.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 138 | [20260922170000_recurring_server_contract](../../../supabase/migrations/20260922170000_recurring_server_contract.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 139 | [20260922180000_claim_recurring_dispatch](../../../supabase/migrations/20260922180000_claim_recurring_dispatch.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 140 | [20260922190000_recurring_worker_gateway](../../../supabase/migrations/20260922190000_recurring_worker_gateway.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 141 | [20260922200000_recurring_worker_queue](../../../supabase/migrations/20260922200000_recurring_worker_queue.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 142 | [20260922210000_recurring_check_backoff](../../../supabase/migrations/20260922210000_recurring_check_backoff.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 143 | [20260922220000_close_recurring_attempt](../../../supabase/migrations/20260922220000_close_recurring_attempt.sql) | 06 | schema | D1, D2, D8, D3, D7 |
| 144 | [20260922230000_apply_recurring_period](../../../supabase/migrations/20260922230000_apply_recurring_period.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 145 | [20260922233000_recurring_fulfillment_gateway](../../../supabase/migrations/20260922233000_recurring_fulfillment_gateway.sql) | 06 | функции | D1, D2, D8, D7 |
| 146 | [20260922234500_prepare_due_recurring](../../../supabase/migrations/20260922234500_prepare_due_recurring.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 147 | [20260922235000_recurring_technical_expiration](../../../supabase/migrations/20260922235000_recurring_technical_expiration.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 148 | [20260923010000_read_recurring_failure_notice](../../../supabase/migrations/20260923010000_read_recurring_failure_notice.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 149 | [20260923020000_scope_recurring_acceptance](../../../supabase/migrations/20260923020000_scope_recurring_acceptance.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 150 | [20260923030000_defer_future_discount_payment](../../../supabase/migrations/20260923030000_defer_future_discount_payment.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 151 | [20260923040000_list_organization_recurring_consents](../../../supabase/migrations/20260923040000_list_organization_recurring_consents.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 152 | [20260923050000_project_payment_processing](../../../supabase/migrations/20260923050000_project_payment_processing.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 153 | [20260923060000_project_payment_order_details](../../../supabase/migrations/20260923060000_project_payment_order_details.sql) | 06 | функции | D1, D2, D8, D3, D7 |
| 154 | [20260924010000_schedule_scoped_sandbox_reconciliation](../../../supabase/migrations/20260924010000_schedule_scoped_sandbox_reconciliation.sql) | 07 | cron | D1, D2, D8, D3, D5, D7 |
| 155 | [20260924020000_sign_scheduled_order_requests](../../../supabase/migrations/20260924020000_sign_scheduled_order_requests.sql) | 07 | функции | D1, D2, D8, D5, D7 |
| 156 | [20260925010000_read_platform_organization_quests](../../../supabase/migrations/20260925010000_read_platform_organization_quests.sql) | 08 | seed | D1, D2, D8, D3, D4, D7 |
| 157 | [20260925020000_read_platform_organization_participants](../../../supabase/migrations/20260925020000_read_platform_organization_participants.sql) | 08 | seed | D1, D2, D8, D3, D4, D7 |
| 158 | [20260925025000_track_quest_attempt_activity](../../../supabase/migrations/20260925025000_track_quest_attempt_activity.sql) | 08 | backfill | D1, D2, D8, D3, D4, D7 |
| 159 | [20260925030000_read_platform_quest_statistics](../../../supabase/migrations/20260925030000_read_platform_quest_statistics.sql) | 08 | seed | D1, D2, D8, D3, D4, D7 |
| 160 | [20260925040000_subscription_refund_requests](../../../supabase/migrations/20260925040000_subscription_refund_requests.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 161 | [20260925041000_subscription_refund_reservations](../../../supabase/migrations/20260925041000_subscription_refund_reservations.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 162 | [20260925042000_subscription_refund_period_binding](../../../supabase/migrations/20260925042000_subscription_refund_period_binding.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 163 | [20260925043000_apply_current_subscription_refund](../../../supabase/migrations/20260925043000_apply_current_subscription_refund.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 164 | [20260925044000_refund_future_trial_period](../../../supabase/migrations/20260925044000_refund_future_trial_period.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 165 | [20260925045000_repurchase_after_trial_refund](../../../supabase/migrations/20260925045000_repurchase_after_trial_refund.sql) | 09 | backfill | D1, D2, D8, D3, D4, D7 |
| 166 | [20260925046000_refund_activated_trial_period](../../../supabase/migrations/20260925046000_refund_activated_trial_period.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 167 | [20260925047000_apply_refund_across_trial_boundary](../../../supabase/migrations/20260925047000_apply_refund_across_trial_boundary.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 168 | [20260925048000_reconcile_subscription_refund](../../../supabase/migrations/20260925048000_reconcile_subscription_refund.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 169 | [20260925049000_retry_subscription_refund_access](../../../supabase/migrations/20260925049000_retry_subscription_refund_access.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 170 | [20260925050000_guard_refund_dispatched_renewal](../../../supabase/migrations/20260925050000_guard_refund_dispatched_renewal.sql) | 09 | функции | D1, D2, D8, D7 |
| 171 | [20260925051000_refund_renewal_preflight](../../../supabase/migrations/20260925051000_refund_renewal_preflight.sql) | 09 | функции | D1, D2, D8, D7 |
| 172 | [20260925052000_guard_zero_renewal_during_refund](../../../supabase/migrations/20260925052000_guard_zero_renewal_during_refund.sql) | 09 | функции | D1, D2, D8, D7 |
| 173 | [20260925053000_check_refund_period_before_reserve](../../../supabase/migrations/20260925053000_check_refund_period_before_reserve.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 174 | [20260925054000_claim_subscription_refund_dispatch](../../../supabase/migrations/20260925054000_claim_subscription_refund_dispatch.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 175 | [20260925055000_record_subscription_refund_result](../../../supabase/migrations/20260925055000_record_subscription_refund_result.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 176 | [20260925056000_prepare_refund_recovery](../../../supabase/migrations/20260925056000_prepare_refund_recovery.sql) | 09 | schema | D1, D2, D8, D3, D7 |
| 177 | [20260925057000_subscription_refund_gateway](../../../supabase/migrations/20260925057000_subscription_refund_gateway.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 178 | [20260925058000_reject_subscription_refund](../../../supabase/migrations/20260925058000_reject_subscription_refund.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 179 | [20260925059000_prepare_subscription_refund_gateway](../../../supabase/migrations/20260925059000_prepare_subscription_refund_gateway.sql) | 09 | функции | D1, D2, D8, D3, D7 |
| 180 | [20260926000000_subscription_refund_history](../../../supabase/migrations/20260926000000_subscription_refund_history.sql) | 09 | функции | D1, D2, D8, D7 |
| 181 | [20260926010000_purchase_document_versions](../../../supabase/migrations/20260926010000_purchase_document_versions.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 182 | [20260926011000_manage_purchase_documents](../../../supabase/migrations/20260926011000_manage_purchase_documents.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 183 | [20260926012000_purchase_document_audit](../../../supabase/migrations/20260926012000_purchase_document_audit.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 184 | [20260926013000_read_purchase_documents](../../../supabase/migrations/20260926013000_read_purchase_documents.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 185 | [20260926014000_record_checkout_documents](../../../supabase/migrations/20260926014000_record_checkout_documents.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 186 | [20260926015000_accept_checkout_with_documents](../../../supabase/migrations/20260926015000_accept_checkout_with_documents.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 187 | [20260926016000_checkout_document_flow](../../../supabase/migrations/20260926016000_checkout_document_flow.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 188 | [20260926017000_list_platform_purchase_documents](../../../supabase/migrations/20260926017000_list_platform_purchase_documents.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 189 | [20260926018000_read_platform_order_documents](../../../supabase/migrations/20260926018000_read_platform_order_documents.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 190 | [20260926019000_receipt_snapshot_storage](../../../supabase/migrations/20260926019000_receipt_snapshot_storage.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 191 | [20260926020000_prepare_sandbox_receipt](../../../supabase/migrations/20260926020000_prepare_sandbox_receipt.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 192 | [20260926021000_manage_sandbox_fiscal_policy](../../../supabase/migrations/20260926021000_manage_sandbox_fiscal_policy.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 193 | [20260926022000_list_sandbox_fiscal_policies](../../../supabase/migrations/20260926022000_list_sandbox_fiscal_policies.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 194 | [20260926023000_receipt_payment_requests](../../../supabase/migrations/20260926023000_receipt_payment_requests.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 195 | [20260926024000_receipt_pending_batch](../../../supabase/migrations/20260926024000_receipt_pending_batch.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 196 | [20260926025000_receipt_contact](../../../supabase/migrations/20260926025000_receipt_contact.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 197 | [20260926026000_recurring_receipt_snapshot](../../../supabase/migrations/20260926026000_recurring_receipt_snapshot.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 198 | [20260926027000_recurring_receipt_requests](../../../supabase/migrations/20260926027000_recurring_receipt_requests.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 199 | [20260926028000_recurring_receipt_poll](../../../supabase/migrations/20260926028000_recurring_receipt_poll.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 200 | [20260926029000_full_refund_receipts](../../../supabase/migrations/20260926029000_full_refund_receipts.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 201 | [20260926030000_refund_receipt_poll](../../../supabase/migrations/20260926030000_refund_receipt_poll.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 202 | [20260926031000_platform_receipt_status](../../../supabase/migrations/20260926031000_platform_receipt_status.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 203 | [20260926032000_receipt_poll_backoff](../../../supabase/migrations/20260926032000_receipt_poll_backoff.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 204 | [20260926033000_prepare_prepayment_settlement](../../../supabase/migrations/20260926033000_prepare_prepayment_settlement.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 205 | [20260926034000_claim_prepayment_settlement](../../../supabase/migrations/20260926034000_claim_prepayment_settlement.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 206 | [20260926035000_list_pending_settlements](../../../supabase/migrations/20260926035000_list_pending_settlements.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 207 | [20260926036000_settlement_poll_backoff](../../../supabase/migrations/20260926036000_settlement_poll_backoff.sql) | 10 | schema | D1, D2, D8, D3, D7 |
| 208 | [20260926037000_platform_settlement_status](../../../supabase/migrations/20260926037000_platform_settlement_status.sql) | 10 | функции | D1, D2, D8, D3, D7 |
| 209 | [20260926038000_tariff_monthly_prices](../../../supabase/migrations/20260926038000_tariff_monthly_prices.sql) | 10 | backfill | D1, D2, D8, D3, D4, D7 |
| 210 | [20260927010000_subscription_fiscal_model_storage](../../../supabase/migrations/20260927010000_subscription_fiscal_model_storage.sql) | 11 | schema | D1, D2, D8, D3, D7 |
| 211 | [20260927011000_subscription_fiscal_model_commands](../../../supabase/migrations/20260927011000_subscription_fiscal_model_commands.sql) | 11 | schema | D1, D2, D8, D3, D7 |
| 212 | [20260927012000_subscription_settlement_due](../../../supabase/migrations/20260927012000_subscription_settlement_due.sql) | 11 | функции | D1, D2, D8, D3, D7 |
| 213 | [20260928010000_subscription_fiscal_reservations](../../../supabase/migrations/20260928010000_subscription_fiscal_reservations.sql) | 11 | schema | D1, D2, D8, D3, D7 |
| 214 | [20260928011000_subscription_fiscal_results](../../../supabase/migrations/20260928011000_subscription_fiscal_results.sql) | 11 | schema | D1, D2, D8, D3, D7 |
| 215 | [20260928012000_subscription_fiscal_refund_binding](../../../supabase/migrations/20260928012000_subscription_fiscal_refund_binding.sql) | 11 | schema | D1, D2, D8, D3, D7 |
| 216 | [20260928013000_subscription_fiscal_refund_lifecycle](../../../supabase/migrations/20260928013000_subscription_fiscal_refund_lifecycle.sql) | 11 | функции | D1, D2, D8, D3, D7 |
| 217 | [20260928014000_subscription_fiscal_refund_endpoint](../../../supabase/migrations/20260928014000_subscription_fiscal_refund_endpoint.sql) | 11 | функции | D1, D2, D8, D3, D7 |
| 218 | [20260928015000_subscription_fiscal_worker](../../../supabase/migrations/20260928015000_subscription_fiscal_worker.sql) | 11 | schema | D1, D2, D8, D3, D7 |
| 219 | [20260928016000_subscription_fiscal_history](../../../supabase/migrations/20260928016000_subscription_fiscal_history.sql) | 11 | функции | D1, D2, D8, D7 |
| 220 | [20260928017000_subscription_fiscal_order_worker](../../../supabase/migrations/20260928017000_subscription_fiscal_order_worker.sql) | 11 | функции | D1, D2, D8, D3, D7 |
| 221 | [20260928018000_subscription_fiscal_acceptance_fixture](../../../supabase/migrations/20260928018000_subscription_fiscal_acceptance_fixture.sql) | 11 | fixture | D1, D2, D8, D3, D6, D7 |
| 222 | [20260930010000_subscription_full_refund_body](../../../supabase/migrations/20260930010000_subscription_full_refund_body.sql) | 12 | функции | D1, D2, D8, D3, D7 |
| 223 | [20260930020000_subscription_settlement_schedule](../../../supabase/migrations/20260930020000_subscription_settlement_schedule.sql) | 12 | cron | D1, D2, D8, D3, D5, D7 |
| 224 | [20260930030000_settlement_receipt_identifier](../../../supabase/migrations/20260930030000_settlement_receipt_identifier.sql) | 12 | функции | D1, D2, D8, D3, D7 |
| 225 | [20261001000000_resolve_refunded_subscription_replay](../../../supabase/migrations/20261001000000_resolve_refunded_subscription_replay.sql) | 12 | функции | D1, D2, D8, D3, D7 |
| 226 | [20261006010000_participant_profile_identity](../../../supabase/migrations/20261006010000_participant_profile_identity.sql) | 13 | seed | D1, D2, D8, D3, D4, D7 |
| 227 | [20261006020000_record_account_activity](../../../supabase/migrations/20261006020000_record_account_activity.sql) | 13 | schema | D1, D2, D8, D3, D7 |
| 228 | [20261007030000_subscription_refund_received_at](../../../supabase/migrations/20261007030000_subscription_refund_received_at.sql) | 13 | schema | D1, D2, D8, D3, D7 |
