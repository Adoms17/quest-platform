# Recovery A auth/GET slice - reviewed local implementation

2026-10-08 21:34 UTC (2026-10-09 Moscow), ADOMS-HOME.
Worktree: `M:/Dev/Projects/quest-platform/fiscal-recovery-a-auth-read.local`.
Branch: `codex/fiscal-recovery-a-auth-read`.
HEAD/base: `fb6b7677029fe223ff7d2659ddb52ae4d4e5f2d5`, merged PR166.
Remote staging was checked at that exact SHA before implementation. The owner
created the separate worktree after automatic review rejected the agent setup
command; setup was not retried or bypassed. The completed PR166 branch is unchanged.

Independent plan review approved this limited slice. Final independent static code
review is reported PASS; all four submitted hashes matched. The reviewer's test
rerun was blocked by cache EPERM, and Git verification by dubious ownership. The
371 PASS result below is author-run evidence, not an independent reviewer rerun.
The owner subsequently authorized a four-file commit, push and draft PR to staging;
actual publication status and exact commit belong to the completion handoff.
No Docker runs, SQL, grants, hosted calls, provider calls,
credentials or runtime/endpoint wiring were added. Existing gates were not read or
changed. New key material in tests exists only in memory.

## Implemented files

- [subscriptionFiscalRecoveryRead.js](../../supabase/functions/_shared/subscriptionFiscalRecoveryRead.js):
  server-only observation orchestrator with strict request IDs, Auth policy,
  existing status-only gateway checks, trusted context/evidence binding, fixed
  provider GETs and fresh post-GET Auth/status/context checks.
- [yookassaSandboxHttp.js](../../supabase/functions/_shared/yookassaSandboxHttp.js):
  extracts the existing private HTTP transport for reuse, preserving original
  request/error/timeout/redirect behavior. A separate named export exposes only
  shop/payment/refund GET methods. It is not spread into subscriptionFiscalHttpMethods
  or the deployed client's method set. Receipt persistence and send hooks are not
  forwarded. No readRefund/readPayment/readFiscalOperation call is used by recovery.
- [subscriptionFiscalRecoveryRead.test.js](../../supabase/functions/_shared/subscriptionFiscalRecoveryRead.test.js):
  106 offline tests, including the real installed Supabase SDK/WebCrypto signature
  path. This report is the fourth changed file.

## Trust and authorization boundaries

The factory is server-only and not imported by any deployed endpoint/runtime.
Its auth client, RPC adapter, provider configuration, clock and context loader are
trusted dependencies, not request fields. An import scan found the new module
referenced only by its test. Request fields are exactly commandId, evidenceId and
client_event_id; an operator-supplied provider ID or extra field is rejected.

Trusted JWT policy requires an exact HTTPS issuer ending in /auth/v1, audience
`authenticated`, zero clock skew, and `nbfPolicy: validate-if-present`. Supplied nbf
must be an integer not later than now; absent nbf is allowed. JWT issuer never
selects the SDK URL/JWKS. The existing authenticateRefundOwner verifies claims via
the SDK, user/subject match, authenticated role, aal2, expiry and TOTP younger than
300 seconds. The new wrapper additionally checks issuer/audience/nbf and checks
expiry/MFA again after async Auth calls. It does not mint fresh timestamps.

Platform-owner/command scope authorization is delegated to the existing
subscription_fiscal_refund_from_gateway action=status, never inferred from the JWT
role alone. Status RPCs are made before and after GETs. The latter uses the newly
verified identity timestamps and requires the same actor. Fake DB denials test the
orchestrator's reaction; this slice adds no DB-role-policy proof or live revocation
guarantee. Its status.refundId is matched against the internal refund row ID, not
the provider refund ID. Review, applied access or a non-sending/unknown status deny.

`loadTrustedContext` has NO persistent implementation in this slice. Its contract
requires an already-authorized DB read with verified sandbox pin, exact immutable
dispatch/evidence provenance and a current scoped snapshot. The fixture's
environmentPin object is a trusted adapter assertion, not a cryptographic proof;
the status response's sandbox string is explicitly insufficient. Allowing client
control of this loader or its result would violate the security boundary.

Context/evidence must agree on command, evidence identity, dispatch, shop, payment,
refund amount, full payment amount, RUB, body/key digests and firstSentAt. IDs and
digests have strict shapes; amounts are positive safe integers; dispatch must not
be in the future or older than 23 hours. The canonical context includes org/order/
internal refund, provider refund and snapshot identity. Before/after contexts must
match, including provider ID, scope and snapshot; no automatic rebase on change.

Provider reads are exactly GET me, GET payments/{trusted UUID}, GET refunds/{evidence
UUID}, using the existing fixed HTTPS origin, redirect:error and bounded timeout.
Shop must be enabled/test and match server config; payment must be paid/succeeded,
test, match shop and full payment amount; refund must be succeeded and match the
evidence ID, payment and refund amount. Partial refund amount is distinct from full
payment amount. No receipt GET, body persistence hook, provider POST or retry.
404/5xx/redirect/malformed/missing data and pending/canceled never produce success.

After reads, fresh Auth/status/context and final clock checks are mandatory. The
result is a frozen normalized `recovery_a_observation`, `commitAuthorized:false`,
with receiptStatus unknown. It contains no raw evidence/body, JWT or credentials.
client_event_id is correlation only: repeating it makes new GET observations, not
a durable replay decision. This module never calls claim, before_send, record,
review, or the private recovery helper, and never changes money/access.

## Persistent integration remains separately gated

Recovery A requires existing durable evidence saved by the trusted sender after
validating the authorized POST response and before losing the application result.
The reader does not create that evidence or upgrade an operator candidate into it.
Missing evidence is B: unknown/review, no attribution by amount/time, no new POST.

Future production context/evidence reads, append-only evidence writes and atomic
recovery commit are distinct capabilities requiring explicit security approval,
migrations/ACL/RLS tests and review. Adding actions to an existing service-role RPC
also expands capability without a new GRANT. Do not use direct service-role table
access or expose the private helper as a shortcut.

The future evidence writer must bind the actual dispatch and validated response,
store only minimal identities/digests (not the prototype's full operation/body),
confirm durable commit/read-back, and have exact retry/conflict semantics. No
continuation after expiry/revoke is approved. The future commit must independently
recheck auth/scope/environment and scoped CAS under locks, preserve unique binding
and event replay, and use existing money/access resolution atomically. This
read-only observation cannot close races after its final read or clear review.
Receipt success and access success are not inferred from monetary succeeded.

## Actual local validation

Final command:

```text
npm run test -- supabase/functions/_shared/subscriptionFiscalRecoveryRead.test.js supabase/functions/_shared/sandboxRefundIdentity.test.js supabase/functions/_shared/yookassaSandboxHttp.test.js supabase/functions/_shared/settlementHttp.test.js supabase/functions/_shared/subscriptionFiscalHttp.test.js supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js supabase/functions/_shared/subscriptionFiscalRefundStorage.test.js scripts/fiscal-recovery-a-verifier.test.js
```

**371 PASS / 8 files**, 2.14s, started 21:34:04 UTC. No skipped tests in this selection.
The first run found an incomplete expected legacy method list in the new test
(findSettlement omitted); that expectation was corrected, without changing the
legacy method set. Final regressions above passed.

- The SDK test generates ephemeral ES256/P-256 keys and a kid in memory, serves a
  fake JWKS at the trusted project URL and spies on actual WebCrypto verify calls.
  Valid tokens use signature verification; forged/wrong-key tokens fail BEFORE
  getUser and provider access. The fake getUser refuses arbitrary bearer values.
  Signed wrong issuer/audience/future-nbf tokens are denied. Fake revoke tests
  failure reaction only. Auto-refresh is stopped, the isolated SDK JWKS cache is
  cleared, and crypto/fetch spies are restored in finally/afterEach.
- Fake provider tests assert exact URLs/methods/redirect mode, independent payment
  and partial-refund amounts, missing fields, evidence mismatches, timeout cleanup,
  role/scope errors, post-GET actor/MFA/expiry/context changes and zero write hooks.
- npm run lint: PASS, eight existing warnings. npm run build: PASS, 80 PWA precache
  entries. Both ran before the final test-only change to await SDK timer cleanup;
  the full selected test command above was rerun after that change.
- git diff --check: PASS. Existing dependencies only; package files unchanged.
- No Docker/full-chain, hosted JWT/Auth, real provider, deployment or production
  acceptance was run. Existing PR166 DB evidence does not validate a new persistent
  adapter, which is deliberately absent.

SHA256 for independent code review:

```text
yookassaSandboxHttp.js
AE6499E7724E5C98518C98DE5C04E3178C8577F6952E506F339C7F6C83E2A2BF
subscriptionFiscalRecoveryRead.js
8905DF2BF52CDA7FD225274D76FE49368C24E6E7979E4733F79574192D4847AA
subscriptionFiscalRecoveryRead.test.js
5E7605E4B8E46B2DD602180FC535FC8C3D66E239ECFBF9DDC29F1C267D297101
```
