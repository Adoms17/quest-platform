# Recovery A - local owner-fixture prototype, reviewed

**Current status:** author-run focused tests **121 PASS / 2 files** (1.02s).
Fresh owner-reported manual full-chain after the schema correction: **3 PASS /
0 skipped** (170.93s), started 2026-10-08 22:17:48 Moscow (19:17:48 UTC).
The prior **2 PASS / 1 FAIL** (169.34s) and its schema correction are recorded below.
Independent final static review: **PASS, limited local prototype**, as reported by
the coordinator; final code hashes matched and reported defects were closed.
No agent full-chain rerun. Publication status is recorded in the completion handoff.
CI-only amendment below is uncommitted and awaiting independent review; its new
Recovery A step has not yet run in CI.
Historical 3/3 DB results below do not validate the current revision.

2026-10-08, ADOMS-HOME. Branch `codex/fiscal-recovery-a-20261008`, worktree
`M:/Dev/Projects/quest-platform/fiscal-recovery-a-20261008.local`.
HEAD/base staging: `b5aa243cdd8d6412b122977046d44069c5522989`.
Remote staging was verified before fetching this missing local commit and creating
the worktree. No commits, push, PR, merge or deployment performed.

The [reviewed DRAFT](PROD-PAY-05-RECOVERY-INJECTION-DRAFT-20261008.md) was copied
unchanged; original and copy SHA256 both:
`9A39BE01ECE7CAEF1A0FDF3CD6C269E77830DA0D5EDF2BA9FA733A7A145C08EC`.
The source DRAFT describes its original worktree; this report records the new one.
AGENTS and process/handoff instructions read. No applicable local skill found.

## Implemented scope

- [fiscal-recovery-a.candidate.sql](../../scripts/fiscal-recovery-a.candidate.sql):
  private evidence/decision tables with RLS and immutable triggers; snapshot helper;
  private recovery helper. CREATE and REVOKE are in one transaction. API roles have
  no direct table/function rights. File is outside automatic migrations and is
  loaded only by the local opt-in harness. No public endpoint/action/grants added.
- [verifier/observer](../../scripts/fiscal-recovery-a-verifier.js): test-only
  immutable provenance and provider identity checks. The observer counts every
  POST separately from deduplicated acceptance, outside the tested handler.
- [focused tests](../../scripts/fiscal-recovery-a-verifier.test.js): identity and
  amount failures, double POST with one acceptance, false audit, wrong ordering,
  and journal persistence while two fresh verifier OS processes execute.
- [DB orchestration](../../scripts/verify-fiscal-recovery-a.js): actual baseline
  gateway claim and durable evidence before synthetic response suppression, followed
  by GET-only retry and owner-fixture private recovery. Independent assertions run
  outside the production flow catch; observer verifies accept→evidence commit→loss.
- [baseline harness](../../scripts/production-baseline-migrations.test.js): adds
  `QVESTA_TEST_RECOVERY_A=1` opt-in; preserves default/presend and existing loss modes.
  New mode uses the existing 600s budget and ownership-checked finally cleanup.
- [loss helper](../../scripts/verify-fiscal-accepted-response-loss.js): two optional
  test callbacks; POST observation happens before assertions a flow could catch.

Recovery calls existing authorized status/record gateways as a trusted SQL fixture
owner, so DB platform-owner/MFA/expiry/scope gates remain exercised. Exact event
replay follows fresh authorization and locks, before original starting-state/CAS
checks. Successful monetary record and saved decision commit atomically. An outer
rollback leaves no financial or decision effects. Concurrent equal events produce
one new outcome and one replay. A committed response is deliberately discarded;
exact retry with the OLD CAS returns stored outcome without another record.

## Historical validation before P2 corrections

Commands used existing dependencies; no installation or lockfile changes:

```powershell
npm run test -- scripts/fiscal-recovery-a-verifier.test.js supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js
$env:QVESTA_TEST_RECOVERY_A='1'
$env:QVESTA_TEST_ACCOUNT_ACTIVITY='0'
npm run test -- scripts/production-baseline-migrations.test.js --reporter=verbose
npm run lint
npm run build
```

- Focused: **97 PASS, 2 files**, final rerun 1.26s.
- Pre-review first full-chain: **3 PASS / 0 skipped**, 208.65s.
- Added access-review, actual non-owner and concurrent replay assertions; final
  pre-review full-chain: **3 PASS / 0 skipped**, 156.97s, DB test 156.073s.
- Lint PASS, eight pre-existing React warnings; final rerun PASS.
- Build/PWA PASS, 80 precache entries. Later changes only strengthened test assertions.
- git diff whitespace check PASS under owner execution context. An earlier sandbox
  git command could not resolve repository ownership; no git settings changed.
- Finally cleanup succeeded, followed by an empty read-only `docker ps -a --filter
  name=qvesta-release-test-` listing. No foreign/shared containers stopped.

Final safe marker (followed by whole-test success after cleanup):

```text
RECOVERY_A: POST=1 accepted=1 evidence_before_suppression=true exact_retry=true concurrent_duplicate=true applications=1 ACL_denials=true
```

The `PRE_RECOVERY_ACCEPTED_RESPONSE_LOSS` marker refers only to the pre-recovery
snapshot: one accepted POST, GET-only retry, unchanged 14 tables, unknown/no access.
After explicit recovery, allowed money/fiscal/subscription/application changes are
asserted separately; other snapshot tables remain identical.

Covered DB negatives: expired JWT context, stale MFA, nonexistent actor, real
non-owner, revoked owner even on exact retry, bad CAS, missing evidence, conflicting
provider ID/result, requires_review, altered event payload, new event after recovery.
API-role SELECT/function calls actually fail for anon/authenticated/service_role;
PUBLIC execute ACL is absent. Two separate psql processes concurrently recover.
An unsafe scheduled subscription preserves monetary succeeded while returning
access review_required, with zero applications; this scenario is rolled back.

## Limits and deliberate exclusions

This is **owner-fixture proof**, not public JWT authenticity, a provider-signed
receipt, public RPC security acceptance, real YooKassa idempotency, hosted recovery
or production readiness. Raw actor/provider inputs are trusted only within the
disposable test runner. No new credentials, role assignments or persistent grants.

The CAS hashes a conservative whole-fixture financial snapshot (including recurring
and scope tables), rather than a production scoped projection. Unrelated writes
can reject new recovery; they cannot authorize it. Exact retry bypasses original
CAS after fresh authorization, as reviewed. A future production snapshot requires
separate concurrency/domain review.

The fake-provider journal is held by the external test runner. It survives handler
recreation in DB integration and verifier process recreation in focused tests;
the full HTTP/DB scenario does not restart an Edge OS process or PostgreSQL server.
Suppression is simulated through the test transport after a separate committed
evidence read-back. No deployed after-accept switch or continuation was introduced.

Evidence persistence is owner-fixture-only; expiry/revoke continuation remains
unsupported. Review-resolution, recovery B, refund_after/settlement and real arm/
consume are excluded. Full money/access success does not imply receipt success:
the tested monetary succeeded result retains receipt unknown.

No hosted/provider calls, SQL writes outside disposable containers, secrets/flags
changes, runtime wiring or deployment. Last reported hosted gates remain false/
false; not reverified here. Independent hosted POST observation is still OPEN.
Hosted NO-GO remains in force. Submit this local diff for independent review.

## P2 corrections and subsequent owner run

1. Recovery now obtains independent fake GET responses for shop, payment and refund
   immediately before the new-recovery checks. The fake resource store is seeded
   separately from the expected claim; GET returns current cloned resource state.
   Changed/missing responses reject before helper mutation; exact replay performs
   no new GET and retains the original immutable request. Focused tests cover all
   three resources. This remains a fake contract, not hosted provider verification.
2. Evidence callback records only evidence COMMIT/read-back. A separate transport
   boundary observes the actually rejected fetch promise and counts suppression.
   False application audit cannot satisfy the suppression counter. Focused tests
   reject committed evidence with a successful (unsuppressed) transport and a
   fabricated suppression audit, and verify an actual rejection.
3. Parity now allows only exact target row IDs and named field transitions in refund,
   fiscal status and subscription; the one application has exact identity and full
   before/after snapshots. All other fields/rows/tables must match. Focused negatives
   cover another subscription, an extra field and a changed refund amount.
4. Concurrency now waits for a named holder in PgSleep, then proves the second backend
   is waiting on a lock held by that exact PID via pg_blocking_pids. Bounded polling,
   lock_timeout and existing statement_timeout apply. The owner-reported failure
   reached parity, which follows these assertions in the code. This is an inference
   from code order and the reported stack, not separately observed barrier evidence
   or a general proof of absence of deadlocks.

Agent full-chain attempts were rejected before execution by automatic review:
it recognized only the initial read-only audit authorization and did not recognize
the later approval to mutate disposable DB/container state. No workaround was used.
The owner subsequently ran the command manually, with the failure recorded below.
No containers were created by the rejected commands; prior cleanup evidence is
historical. SQL candidate, production runtime, ACL design and hosted scope unchanged.

Historical P2 focused run: **106 PASS / 2 files**, 0.955s. At that revision,
whitespace check PASS; lint PASS with eight existing warnings, build/PWA PASS with
80 precache entries. These are not fresh lint/build results for the schema correction.

## Schema correction and current evidence

- Prior owner-reported manual full-chain: **2 PASS / 1 FAIL**, 169.34s. Parity failed on
  `organization_subscriptions.updated_at timestamp`. The table's migration defines
  `created_at`, not `updated_at`; the full `to_jsonb(t)` snapshot did not lose a field.
  The focused fixture had incorrectly invented `updated_at`.
- The verifier now requires the actual subscription schema and preserves exact
  `created_at` equality. Other timestamp fields must exist and parse as strings;
  initial SQL NULL is allowed only for fiscal `checked_at`. Exact row/field parity
  and the subscription revision increment of one remain enforced.
- Focused regressions cover PostgreSQL timestamp strings, missing/invalid fields,
  unexpected subscription `updated_at`, changed/missing `created_at`, and missing
  initial `checked_at` versus SQL NULL.
- Author-run focused command listed above: **121 PASS / 2 files**, 1.02s, completed
  2026-10-08 19:02:43 UTC. Whitespace check PASS. The agent did not rerun full-chain;
  the subsequent successful owner run is recorded separately below.
- The prior failing run's reported stack is consistent with reaching parity after the preceding
  concurrency assertions; lock-barrier PASS is not independently established.
  Subsequent exact-retry and revoked/altered replay checks occur after parity and
  were not reached in that failing owner run.
- `sandbox_provider_transport network_error` is consistent with the intentional
  synthetic lost-response injection, not evidence of a real provider request.
- At **2026-10-08 19:05:40 UTC**, a read-only `docker ps -a --filter
  name=qvesta-release-test-` listing returned no matching containers. This is a
  point-in-time observation, **not proof of cleanup execution** in the owner run.
  No containers were deleted during that check.

Schema-correction SHA256:

```text
scripts/fiscal-recovery-a-verifier.js
332AE7A0972ECAE064325C361A4EFB08E6825A25E840F96353AFC15C4DF1CE78
scripts/fiscal-recovery-a-verifier.test.js
DCD638C86BCDCCADFD125EFFDA083657723A97034C41FB3D5C8ED197F7DAD634
```

No hosted execution. Implementation is unchanged following final independent review.

## Fresh owner full-chain and post-restart access check

### Owner-reported execution (not an agent-run test)

The owner reported the fresh run after the schema correction: start
**2026-10-08 22:17:48 Moscow / 19:17:48 UTC**, total **170.93s**, **3 passed of 3,
0 skipped**; final integration test **170036ms**. Reported markers:

```text
RECOVERY_A: POST=1 accepted=1 evidence_before_suppression=true exact_retry=true concurrent_duplicate=true applications=1 ACL_denials=true
PRE_RECOVERY_ACCEPTED_RESPONSE_LOSS: accepted=1 POST=1 retry_POST=0 new_backend_each_RPC=true unknown=true access_unchanged=true snapshot_tables=14
```

Read-only code inspection confirms that this final successful test includes:

- Mandatory lock-barrier assertions in
  [verify-fiscal-recovery-a.js](../../scripts/verify-fiscal-recovery-a.js#L89):
  observe the holder in PgSleep, then the waiter blocked on that holder's PID via
  `pg_blocking_pids`, await both processes, require successful exits and exactly
  one fresh outcome plus one replay. The recovery marker follows these assertions,
  parity and subsequent exact-retry/revocation/conflict checks.
- Mandatory finally cleanup in
  [production-baseline-migrations.test.js](../../scripts/production-baseline-migrations.test.js#L902).
  Each tracked full container ID is checked against its ownership label before
  removal (lines 96-99); any cleanup error is collected and thrown before the test
  can pass (line 909). The recovery marker alone would not establish cleanup;
  the reported final test PASS includes completion of this cleanup path.

Thus the owner's reported successful run, interpreted against the inspected code,
supports passing the concrete lock barrier and required cleanup. It is not a new
agent-observed execution or an independently captured backend/cleanup trace, and
does not prove general deadlock freedom, real-provider behavior or hosted readiness.

### Agent read-only observations after restart

At **2026-10-08 19:25:26 UTC / 22:25:26 Moscow**:

- Hostname: `ADOMS-HOME`; the requested recovery worktree is accessible.
- Branch: `codex/fiscal-recovery-a-20261008`; HEAD:
  `b5aa243cdd8d6412b122977046d44069c5522989`.
- Working tree retains two tracked modifications and six untracked prototype/report
  files; no commit, branch switch or reset was performed.
- Docker daemon responds, server version **29.8.2**. Read-only listing of all
  `qvesta-release-test-*` containers returned no matches. This independent current
  absence observation does not by itself prove the earlier cleanup execution.
- No containers or tests were started; nothing was deleted. Only this QA report was
  edited. Restart did not remove the existing restriction on agent full-chain runs.

Current implementation SHA256 (verifier and focused-test hashes also match above):

```text
scripts/fiscal-recovery-a.candidate.sql
0B4657511492B0AA0D69FA6F0A83AE4A44E668ABA39D21533FAE4B71E4AAE89C
scripts/verify-fiscal-recovery-a.js
46AF61A87498C39C0BEAA227217BC70E061AF8241A87C05191E62D4D1711009D
scripts/verify-fiscal-accepted-response-loss.js
7E405D83E937CDE447EA6454361CB285AFFD3439CE03964EB80E23F23D3F2178
scripts/production-baseline-migrations.test.js
4226BAE2336FE25937ED7C3C233E267E979D67FAA5C56B8DCF31C2BD3A5B9C77
```

Independent final static review is reported PASS for the limited local prototype.
The owner's subsequent authorization covers a commit, branch push and separate
draft PR to staging; it does not authorize merge or deployment.

## CI coverage and publication boundary

Published commit `10ed5d772bd662959a66ffa570332afd2f5499d6` in draft
[PR166](https://github.com/Adoms17/quest-platform/pull/166) contains eight script/QA
files. Its [CI run](https://github.com/Adoms17/quest-platform/actions/runs/37833559192)
finished SUCCESS at 19:49:01 UTC: baseline 3 PASS / 80.26s and accepted-response-loss
3 PASS / 79.94s, both without skips; unit 2369 PASS / 134 skipped (including 42
verifier and 79 endpoint tests); e2e 293 PASS / 34 skipped. CodeQL also succeeded.
That workflow did **not** enable Recovery A: its DB log has only the
`ACCEPTED_RESPONSE_LOSS` marker, not `RECOVERY_A`. These results are not a Recovery A
DB rerun. Its full-chain evidence remains the successful owner run above.

### Authorized CI-only amendment, pending independent review

Local and remote HEAD were both verified as `10ed5d772bd662959a66ffa570332afd2f5499d6`
with a clean worktree before editing. Only `.github/workflows/ci.yml` and this report
are changed; the aggregate PR scope will become nine files after publication.

The existing `production-billing-sql` job gains a separate final step,
`Recovery A with durable evidence and exact replay`, running the same verbose
baseline test command with explicit flags:

```yaml
QVESTA_TEST_PRODUCTION_BASELINE: '1'
QVESTA_TEST_RECOVERY_A: '1'
QVESTA_TEST_ACCEPTED_RESPONSE_LOSS: '0'
QVESTA_TEST_ACCOUNT_ACTIVITY: '0'
```

Recovery A itself enables the accepted-loss branch through the harness's OR
condition; disabling the independent loss flag does not disable that prerequisite.
Account activity is explicitly off. Existing historical and accepted-loss steps
are unchanged. Job timeout increases from 15 to 30 minutes to cover preparation
and three serial harness runs (existing per-test caps: 180s, 600s, 600s).
The unchanged harness creates unique owner-labeled containers and checks exact IDs
and ownership before finally cleanup; cleanup failure fails the test. No new
permissions, secrets, runtime, automatic migrations or deployment wiring.

Local validation of the amendment: YAML parsed with the existing Playwright-bundled
YAML parser (no added dependency), zero parse warnings/errors and duplicate-key
checks enabled. Semantic comparison with HEAD confirmed that only the added step
and timeout differ; all existing jobs, steps, triggers and permissions match.
`git diff --check` PASS; `npm run lint` PASS with eight existing warnings;
`npm run build` PASS, 80 PWA precache entries. No local Docker/integration run.

Workflow SHA256:
`7B62E170175588C6E9355396FEA608BC605A9FBB4767F622F7832EA12C94F034`.
Commit/push are held for independent review. No new CI run is claimed yet.

After review and publication, acceptance requires an exact-new-SHA terminal CI
run with all three DB steps successful, each 3 PASS / 0 skipped. The new step must
show both `RECOVERY_A: POST=1 accepted=1 evidence_before_suppression=true
exact_retry=true concurrent_duplicate=true applications=1 ACL_denials=true` and
`PRE_RECOVERY_ACCEPTED_RESPONSE_LOSS: accepted=1 POST=1 retry_POST=0
new_backend_each_RPC=true unknown=true access_unchanged=true snapshot_tables=14`.
Final step success must follow mandatory lock-barrier/parity/replay checks and
ownership-checked cleanup; markers alone are insufficient. Report validate/CodeQL
and skipped tests separately; a timeout, skipped new step or missing marker is not
Recovery A acceptance.

Recovery B, public-runtime/JWT/provider authenticity and hosted acceptance remain
outside this proof. No hosted recovery or production GO.
