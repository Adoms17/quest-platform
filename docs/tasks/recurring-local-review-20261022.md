# Local review: recurring alignment, 2026-10-22

Reviewed commit: 3c36f5c9af45c5ecdfe66bfeb5b72bb40fc900b4.
Base: fe01bfc9eb9c0a05c45775104c854816c8215bb4.
Branch: codex/recurring-alignment-local-20261022.

## Finding fixed (medium)
RecurringConsent.jsx:9-18: the initial asynchronous read was only protected against unmount, not a newer explicit operation. Reproduction: leave initial read pending; refresh returns saved; revoke returns revoked; resolve initial read with none/canRequest=true. UI reverted to offering consent. A late initial rejection instead injected an obsolete error. This race existed before the reviewed commit, but affects its consent/revocation behavior. It does not bypass server authorization.

Added request version invalidation matching the existing organization consent component. Only current initial responses can update state/error. Explicit operations remain serialized. Two deferred-promise tests prove the stale success and stale failure cases; before fix both failed (5 existing passed), after fix both passed.

## Review conclusions
- Consent remains explicit, unchecked initially, disabled without acknowledgement; in-flight operations block duplicate clicks. Remount on organization/order change isolates previous responses and checkbox state.
- Revocation does not promise cancellation of an already started payment. Migration 20260922180000_claim_recurring_dispatch.sql:2-4 defines the dispatch authorization boundary; reviewed UI uses future charges versus reconciliation wording. No SQL was executed.
- API still rereads authoritative state after mutation; unknown mutation outcome is not shown as success. Refresh permits recovery without another mutation. Existing tests cover generic errors, uncertain revocation, double actions and stale organization responses. Server foundation revocation uses ON CONFLICT DO NOTHING; server behavior was inspected, not re-executed here.
- Shared terms and draft Agreement/PaymentTerms preserve OPS-01.4 pinned tariff version, discounted periods including first purchase, zero-charge periods, failed-payment semantics and support expiry notice. Draft headers remain. No new business conditions or legal acceptance were added in this review.
- Sandbox visibility, provider adapter, migration files and worker configuration have no diff against the base. Existing visibility tests cover allowed/denied environments. Full SHOP scope is retained. Text alignment is not proof of commercial payment integration.

## Commands and evidence
From recurring-alignment:
1. npm.cmd test -- --config vitest.local-alignment.config.js src/components/RecurringConsent.test.jsx --reporter=verbose
   Before fix: 2 FAIL, 5 PASS. Log ../recurring-review-red.log.
2. npm.cmd test -- --config vitest.local-alignment.config.js src/components/RecurringConsent.test.jsx src/components/OrganizationRecurringConsent.test.jsx src/components/RecurringFailureNotice.test.jsx src/services/recurringConsentApi.test.js src/services/sandboxCheckoutVisibility.test.js src/pages/OrganizationBilling.test.jsx --reporter=verbose
   After fix: 6 files, 48 PASS, 0 FAIL, 0 SKIP; 16.86 s. Log ../recurring-review-tests.log.
3. npm.cmd run lint: exit 0, existing warnings in unchanged source; ../recurring-review-lint.log.
4. npm.cmd run build: exit 0, PWA generated, 90 precache entries; ../recurring-review-build.log.
5. git diff --check: PASS.

The prior 3c36f5c stage separately passed two synthetic activity/avatar browser tests, website native-config-loader build and four sites tests. These are prior evidence, not rerun counts for this review; current fix only changes order consent and its tests. No full suite, CI, provider sandbox, B17, production or real payments were run.

## Decision
Ready to propose publication of this local branch for code review after owner decision; not published by this task. No remaining blocker found within the reviewed local delta. This is not production readiness: actual provider sandbox acceptance, backend prerequisites/migration gates, B17, recovery proof and final approved commercial documents remain separate. UI tests with mocked backend cannot validate dispatch concurrency, financial settlement or provider integration.