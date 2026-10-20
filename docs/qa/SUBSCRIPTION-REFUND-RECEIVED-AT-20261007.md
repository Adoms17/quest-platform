# Subscription refund received_at: local review candidate

Worktree: M:/Dev/Projects/quest-platform/subscription-refund-received-at-20261007.local
Branch: codex/subscription-refund-received-at-20261007
Baseline: d45bc17bee499465fcf0c7848e7d00bf259d5d76
Status: local candidate, uncommitted; independent review required.

## Behavior and audit

Email registration accepts the actual confirmed receipt instant only through the existing platform-owner gateway and fresh MFA. requested_at remains server registration time; received_at and receipt_source are separate immutable audit fields. The private snapshot retains registered_by, source and both instants. Ordinary client access to the table and core RPCs remains denied. Existing eight-argument gateway and three-argument core compatibility paths remain available with server-time semantics. Unknown historical receipt timestamps remain NULL; the migration does not backfill or rewrite old rows.

Received time must be finite and no later than server registration. There is no new lower-date rule: early timestamps are preserved, while the existing capped prorata formula determines the amount. RUB, remaining balance, prior refunds, pending checks and sandbox restrictions remain unchanged. Registration neither reserves money nor changes subscription access; reserve and execute remain separate existing steps.

Equal receipt instants with different offsets are equivalent. Same-key retry preserves its recorded quote; changed source/time fails explicitly. UI persists actor/organization/order-scoped receipt metadata before the request and retries exactly after unknown outcomes or remount. A confirmed HTTP 400 invalid-time rejection permits correction using a fresh command; unknown errors and conflicts preserve the original metadata. Browser input uses the displayed local time zone and sends an ISO instant.

## P2 independent-review correction: legacy quote recovery

A fresh-session inapp registration can replay an existing historical row whose receipt_source and received_at are explicitly NULL. The API now accepts only that complete NULL pair with finite, matching requested_at/registered_at, the existing subscription-prorata-v1 policy, reserved=false and access_effect=unchanged. Missing/partial NULL fields, invalid or inconsistent registration times, another policy, and changed monetary/access state fail invalid_quote. Email requests still reject unknown time, and new inapp quotes must retain matching server receipt and registration timestamps. The API derives receiptTimeUnknown itself; a response-supplied marker cannot bypass validation. The UI names the recovery option and explicitly displays that receipt time is unknown while preserving original amount and registration date. No timestamp backfill, recalculation, SQL or gateway change.

Regression tests start with empty sessionStorage, use the real API adapter, recover the original request_id/amount, and continue reserve/execute using that existing request. Browser variants cover both the original email flow and fresh-session legacy recovery with retry on desktop/mobile.

Latest P2 validation:

- PASS: 44 unit tests / 3 files; .review.local/refund-legacy-units.log.
- PASS: 4 ordinary/legacy browser tests, desktop/mobile, exit 0; .review.local/refund-legacy-browser.log. The own Vite preview process stayed alive after all tests and was stopped using its known logged PID (13364) in the normal sandbox; Playwright then exited 0.
- PASS: lint; .review.local/refund-legacy-lint.log; warnings remain in unchanged files.
- PASS: root build with envDir:false synthetic settings, and admin build through browser webServer; .review.local/refund-legacy-build.log.
- PASS: candidate manifest integrity, unchanged 327 migrations; .review.local/refund-legacy-manifest.log.
- PASS: 2 fiscal receipt/status browser tests, desktop/mobile, exit 0; .review.local/refund-legacy-fiscal-browser-final.log. First attempt failed before tests because the preceding browser server still owned port 4185; separate final run passed. Its own logged preview PID (2184) also needed stopping after all tests completed; no unrelated processes were terminated.
- NOT RERUN: SQL and Edge Runtime unchanged by P2. Prior results below remain applicable; independent SQL rerun and Docker inventory remain blocked by the previously reported Docker pipe permissions. No bypass attempted.

P2 changes: admin/src/subscriptionRefundApi.js, admin/src/SubscriptionRefund.jsx, admin/src/subscriptionRefundReceipt.test.js, admin/src/subscriptionRefund.test.jsx, admin/e2e/access.spec.js and this report. The earlier source patch is preserved as .review.local/refund-before-legacy-recovery.patch. All P2 reads, edits, unit/browser/lint/build/manifest and own preview cleanup used ordinary sandbox commands. A single tracked git diff export required repository-owner execution after Git explicitly reported dubious ownership; no trust/ACL/policy settings were changed.

## Initial validation

- PASS: final targeted Vitest run, 4 files / 32 tests; .review.local/refund-validated.log. Includes 31 UI/API/Edge unit tests and disposable SQL harness.
- PASS: SQL harness applies historical billing migrations and candidate; compares a pre-migration immutable legacy row and confirms new columns remain NULL. Runs subscription_refund_received_at, preparation, requests, boundary and preflight pgTAP suites. Tests delayed registration, offsets, boundaries, early/future/invalid input, inapp, conflicts, balance, rights/fresh MFA, immutability and no monetary/access side effects.
- PASS: pinned local Edge Runtime, 2 tests; .review.local/refund-edge-runtime.log. Disabled/origin/no-store guards verified with synthetic setup. No full online provider integration claimed.
- PASS: ordinary refund browser scenario, desktop + mobile, 2 tests; .review.local/refund-browser-final.log.
- PASS: fiscal receipt/status retry browser scenario, desktop + mobile, 2 tests; .review.local/refund-fiscal-browser-final.log. All provider responses mocked.
- PASS: npm run lint; .review.local/refund-lint-checked.log. Existing warnings in unchanged QuestPlay, OfflineEventReviews and Tariffs remain.
- PASS: npm run build -- --config .review.local/refund-app.vite.mjs --mode staging; .review.local/refund-build.log. The normal root config is composed with envDir:false and synthetic public settings. Admin builds also passed in browser webServer setup. Bundle size warning remains.
- PASS: candidate manifest integrity, 327 historical migrations; .review.local/refund-manifest.log. Manifest and exact release list updated only for the added migration; this grants no deployment approval.
- NOT RUN: full production-baseline database chain including unrelated profile/activity migrations; remote SQL, deployment, real provider and money operations.

Earlier attempts failed on disposable fixture pending-order collision, ambiguous fixture id, missing pgTAP schema usage, browser datetime-local seconds input, and a harness syntax error introduced while removing a lint warning. Each was corrected and the affected final checks passed; earlier logs are retained.

## Migration and review artifacts

Migration: supabase/migrations/20261007030000_subscription_refund_received_at.sql
Raw file SHA-256: ba09850040582134add330eaba60b6d18fb4c4352f6d5d720a8842b92bcd425c
Exact patch including new files: .review.local/refund-received-at-candidate.patch
The patch has not been staged or committed. Review migration/gateway overload compatibility and timestamp/idempotency contract before any release. Deployment sequencing would require the migration before extended Edge/UI requests; no deployment performed.

## Cleanup and execution context

Disposable SQL containers use unique owner labels, full IDs, network none, no host binds/forwarded ports. The successful harness completed its finally cleanup, which verifies ownership and removes only its created containers. Additional Docker inventory check returned permission denied on the Docker pipe in the sandbox; it was not retried or bypassed. Independent post-cleanup inventory is therefore NOT VERIFIED. Ignored .review.local logs/builds/configs and the node_modules junction are retained for review; no dependency installation or lockfile changes. Root checkout and unrelated worktrees were not edited in this continuation.

Execution sandbox: workspace-write, restricted network. Worktree is inside the writable root M:/Dev/Projects/quest-platform; temporary directories are also writable. Git reported dubious ownership because the sandbox Windows account differs from the repository owner. No trust, safe.directory, ACL, credentials, Full Access or approval-policy settings were changed. Some previous calls unnecessarily used require_escalated for ordinary reads/tests; subsequent reads/writes used normal permissions. Only generation of the tracked git diff still required repository-owner execution. Additional Docker pipe denial remains a verification limitation.
