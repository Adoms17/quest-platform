# Recovery context R: local implementation review

Snapshot: 2026-10-08 22:34 UTC. Status: local candidate ready for independent code review; database acceptance NOT VALIDATED.

## Baseline and authority

- Host: ADOMS-HOME. Worktree: `M:\Dev\Projects\quest-platform\fiscal-recovery-context.local`.
- Branch: `codex/fiscal-recovery-context`; HEAD/base: `b54611002f749b2b780e679bccaa1fe206bb7e9b` (staging after PR167).
- Owner-created worktree was clean before implementation. Scope is the approved local R-only slice following independent design review. Existing tracked files are unchanged; the seven files listed below are untracked. No commit, push, PR, deployment or runtime wiring.
- Design reference in sibling worktree: `fiscal-recovery-a-auth-read.local/docs/qa/PROD-PAY-05-PERSISTENT-CAPABILITY-DESIGN-20261008.md`; recorded SHA256 `752096B792BA472D114E1EBED6495DF67A63BE6480A8858873E06D52CE2560AB`.
- SQL application, DB/ACL/GRANT execution, Docker/fullchain, E/C capabilities, hosted/provider/Auth calls and financial actions remain outside this slice.

## Implementation

`scripts/fiscal-recovery-context.candidate.sql` is deliberately outside automatic migrations. It defines a private, RLS-enabled, immutable synthetic evidence fixture table and a private reader. It proposes exactly one additional action, `read_recovery_context`, in the existing service-only gateway, preserving its original body/guards and checking unchanged function ACL. It issues no new GRANT. This is a capability extension candidate, not evidence that the deployed gateway supports R.

The reader resolves command scope before evidence lookup; binds the existing command, reservation, refund, order, organization, payment, fiscal operation, dispatch and evidence; and derives a versioned scoped digest from explicit related columns. The real dispatch primary key is `refund_id`, so `dispatchId` equals `internalRefundId`; provider refund ID remains separate. Timestamp serialization retains six UTC fractional digits, and the idempotency digest uses canonical DB UUID text. No raw fiscal body/contact data is projected.

After preceding lock waits, the candidate repeats owner and sandbox-pin checks, checks live user/scope existence, and then checks JWT expiry/MFA using `clock_timestamp()` before returning. Private-reader failures use the same SQLSTATE/message without foreign evidence/provider IDs or SQLERRM. The gateway retains its existing outer denials.

`subscriptionFiscalRecoveryContextStorage.js` is an unwired dependency-injected adapter. It accepts server-verified identity and command/evidence IDs; requests only R; rechecks freshness after the RPC; validates exact minimal projection/bindings; preserves timestamp bytes; returns a frozen clone; and converts all errors to `recovery_context_unavailable`. It has no runtime imports/wiring and performs no provider calls itself. The composed offline PR167 test uses only fake R/status RPCs and three fake provider GETs, returning `commitAuthorized: false`.

The SQL fixture requires an owner-created disposable synthetic sending/unknown command and seeds only normalized evidence with `source=synthetic_owner_fixture`. It does not establish real sender provenance or introduce an E action. The deferred pgTAP file contains 28 planned assertions, not 28 executed checks.

## Validation actually executed

All commands ran locally in this worktree on 2026-10-08 UTC:

| Command | Result |
| --- | --- |
| `npm run test -- supabase/functions/_shared/subscriptionFiscalRecoveryContextStorage.test.js supabase/functions/_shared/subscriptionFiscalRecoveryRead.test.js supabase/functions/_shared/subscriptionFiscalRefundStorage.test.js supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js` | PASS: 4 files, 249 tests, 1.93 s |
| `npm run lint` | Exit 0; 8 warnings in existing OfflineEventReviews, Tariffs and QuestPlay UI files |
| `npm run build` | PASS: 349 modules; PWA 80 precache entries; generated ignored local dist output |
| `git status --short`, branch/HEAD, `git diff --stat`, `git diff --check` | Existing tracked files unchanged; six implementation files untracked before this report. Diff checks do not inspect untracked contents. |

Offline tests cover exact R arguments, identity expiry before/after asynchronous waits, defensive identity snapshot, minimal immutable projection, missing/foreign/malformed responses, uniform errors, timestamp preservation and fake GET-only composition. Two tests inspect SQL text only; they are NOT PostgreSQL syntax, ACL, RLS or lock validation. No full unit suite or E2E rerun was needed for this unwired slice; prior PR167 results are historical baseline evidence, not reruns here.

## Required before any database acceptance or wiring

**SQL was not applied, parsed or executed by PostgreSQL. ACL/RLS/locks are NOT VALIDATED.** Schema compatibility and ACL assumptions were reviewed from checked-in migration source only. No ambiguity justified bypassing this boundary.

A separately authorized disposable DB exercise must first validate full-chain prerequisites and the dynamic gateway patch against the actual function definition. Then execute and review the deferred pgTAP checks, plus these missing cases:

- Two real DB backends: expiry and stale MFA after lock waits; owner revocation/scope change while waiting; competing writer lock order and deadlocks.
- Real existing foreign evidence from another prepared command: same denial with no identity disclosure. The deferred file's unrelated UUID case does not replace this test.
- Production/unpinned environment denials; direct table/function privileges and immutable evidence DML negatives under actual roles.
- Scoped digest changes for each relevant mutation and stability for unrelated data; concurrency consistency across earlier locked-row reads and additional snapshot queries.
- Zero financial/domain writes, preserving existing gateway actions and claim restoration, with actual DB observation. JS mocks cannot prove these properties.

R is an observation capability. The digest does not authorize commit and is not an implemented atomic CAS. E provenance, C atomic commit, replay/idempotency persistence, migration adoption, runtime integration and production Go are separate work/approval boundaries.

## Deliverables and SHA256

| File | SHA256 |
| --- | --- |
| `scripts/fiscal-recovery-context.candidate.sql` | `660EB4A325273E637623A3D302CBD54E21B8B40C3904C384877F8A45F0A25974` |
| `scripts/fiscal-recovery-context.database.sql` | `2E667FFB07EAC76DA011C5CF52F371C0C87A2D18BFA6FD483F48D75C797641FC` |
| `scripts/fiscal-recovery-context.fixture.sql` | `6178E208EBC04726D658989C43AAE090A28511DA3A0A198D98A1A2486266D696` |
| `scripts/fixtures/fiscal-recovery-context.js` | `62B22D4FB764B650EBE40235F82014DD14E9BB8B02800E98744908D7409452BD` |
| `supabase/functions/_shared/subscriptionFiscalRecoveryContextStorage.js` | `6CDB95E96CF548AE7325FB9B007064AE7CC579FCB452399956617F0F96F27209` |
| `supabase/functions/_shared/subscriptionFiscalRecoveryContextStorage.test.js` | `C429C8BAB728F5F2CF613A1CF86FA585B7DA784249083971E76F5785CAB04642` |
| `docs/qa/PROD-PAY-05-RECOVERY-CONTEXT-R-LOCAL-20261008.md` | This report; hash supplied in completion message |

Next handoff: independent review of these local files. Do not infer permission to apply the candidate or enable any recovery action from this report.
