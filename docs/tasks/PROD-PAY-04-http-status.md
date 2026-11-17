# PROD-PAY-04 — scoped HTTP status acceptance

03.10.2026. User approved implementation and PR preparation after explicit explanation of read-only mode. Base: 60b33d409b4362f0f0d990a58eeb69fa58aa072a. Branch: codex/refund-status-acceptance. No stage/production release authorized by this report.

The existing admin-subscription-fiscal-refund endpoint accepts action=status only when ADMIN_SUBSCRIPTION_FISCAL_STATUS_COMMAND_ID names one existing command. This configuration forces read-only mode, regardless of dispatch flags. Other commands, reserve and execute are rejected. An invalid configured UUID fails closed. Without the setting, existing financial behavior is unchanged and status is unavailable.

Status uses the existing authenticateRefundOwner signature/user/expiry/fresh-TOTP checks and subscription_fiscal_refund_from_gateway status action. SQL retains owner, sandbox environment, shop and operation scope checks. Only the existing whitelisted status fields are returned. No provider client, provider secret, claim, reservation, record or refund request is used in status mode. No schema or RLS changes.

## Stage acceptance sequence after reviewed release

1. Keep financial flags off. Choose one existing linked command after read-only verification of its shop/environment/scope. Record counts of commands, reservations, attempts and relevant status fingerprints before testing.
2. Deploy only this endpoint using the reviewed commit; configure the single command UUID. Verify fresh owner identity can read status (positive control), and execute/reserve/wrong target cannot reach storage or provider.
3. Use a controlled test session with real signed JWT retained in memory only. Never export browser credentials or save tokens in reports/logs. A dedicated user login harness is still required; ordinary browser auto-refresh cannot prove expiry of the original JWT.
4. Fresh non-admin identity must fail SQL authorization (403). Owner TOTP older than 300 seconds with JWT still valid must return authentication_required (401). Wait for actual expiry of the same retained token; distinguish gateway refusal from handler refusal. Do not fake claims or clocks for stage evidence.
5. Compare state counts/fingerprints. Clear scoped configuration, verify endpoint returns sandbox_disabled with financial flags off. Record timings and sanitized HTTP outcomes, never token values.

This proves authentication and initial authorization in the real endpoint's read branch, not execution/reconciliation or before-send authorization. Existing SQL/integration tests remain necessary. Production readiness stays open.

## Local checks

39 tests passed across subscriptionFiscalRefundEndpoint.test.js and sandboxRefundIdentity.test.js, including status-only override, no provider I/O, target restriction, expired/stale/rejected identity, gateway denial and invalid configuration. These mocked identity cases are not live stage evidence. Lint passed with existing warnings. Build result recorded below.
Build/PWA PASS (exit 0); git diff --check PASS. No dependencies installed; node_modules uses a junction to the existing checkout.
