# PROD-PAY-04/05: committed claim and final SQL refusal

Current status (2026-10-04): isolated SQL execution and final independent review PASS;
local slice accepted. Coordinator authorized a local commit of these three files.
Earlier blocked/NOT RUN statements below are dated history, superseded by the
execution evidence at the end. Notion write block and publication hold remain.

Worktree: `M:\Dev\Projects\quest-platform\prod-pay-final-send-tests.local`.
Branch: `codex/prod-pay-final-send-tests`.
Parent commit: `e9f99981ab1919df2a4eeeeeb85dc391a23a6511`.
Sole writer: this delegated Codex session. No commit/push/PR/merge/deploy in this step.
The original docs-bootstrap and evidence worktrees were not edited.

## Gap and implementation

The accepted endpoint tests use mocked SQL. Existing lifecycle SQL checks use
savepoints in a single transaction. Neither alone proves that a committed claim
survives a later failed RPC, including its aborted connection, and that a retry
does not acquire a second dispatch.

The new terminal fixture in
[`production-baseline-migrations.test.js`](../../scripts/production-baseline-migrations.test.js:698)
reuses the existing paid checkout, receipt model and linked-refund preparation
prefix. It applies no provider result. The dedicated
[`subscription_fiscal_presend_commit.test.sql`](../../supabase/tests/database/subscription_fiscal_presend_commit.test.sql:1)
claims through the real gateway as `service_role`, verifies one dispatch and no
access application, and intentionally COMMITs the synthetic fixture.

Every subsequent `sql()` launches a separate `psql` process. A valid
`before_send` control must authorize the saved key/hash. Three actual gateway
calls then fail with PostgreSQL SQLSTATE evidence, not mocked exceptions:

| Final check | Identity | Expected SQLSTATE | Retry |
| --- | --- | --- | --- |
| Expired identity | Fresh MFA, exp now minus 1 second | 42501 | reconcile |
| Stale MFA | MFA now minus 301 seconds, valid exp | 42501 | reconcile |
| Wrong saved body hash | Fresh MFA and valid exp | 55000 | reconcile |

After each refusal and each retry a new session compares complete, ordered JSON
snapshots of 14 relations: orders, payment results, monetary refunds, fiscal
ledgers/operations/status, refund requests/reservations/dispatches/period bindings/applications,
subscriptions, period confirmations and review resolutions. This must preserve
timestamps, key/hash, amounts and access; dispatch count starts at one and must
remain one. Status must remain sending/unknown, no review, access not applied.
No record/review RPC, provider SDK or HTTP sender participates in this test.
The initial snapshot must contain exactly one request and one reservation linking
the claimed command to the selected monetary refund; the refund's fiscal command
must match that request. Reservation rows participate in every later comparison.

The fixture runs last because it commits. It is ONLY for the disposable harness;
never run the SQL file alone or against shared/stage/production databases.
It uses synthetic fixture identities, not the settled postGuard order or JWTs.

## Execution boundary and validation

The opt-in harness is configured to create its own random `qvesta-release-test-*`
containers with `--pull never`; no image download is permitted. It stores the
full IDs returned by successful `docker create` calls before starting anything.
Actual `docker inspect` data must pass preflight before either container starts:
owner label and ID, database network `none`, Auth network `container:<databaseId>`,
no published ports, host bind/supplied mounts, inherited container volumes,
host privileges or restart policy. Image-declared anonymous volumes are allowed
only at the image's declared destinations with generated 64-hex names.

Actual container environment must exactly equal image defaults plus the explicitly
generated local Auth settings; credential-like nonempty image defaults are refused.
No host environment is forwarded to either container. Comparisons do not print
environment values. Auth is checked again after its local migration exits, including
exit status; database isolation is checked again after startup. These are assertions
to execute, **not runtime evidence**: Engine, image availability, inspect metadata,
volume ownership and SQL remain unverified in this session.

All inspect/exec/start/cleanup operations target captured IDs. Finally attempts
cleanup of both IDs in reverse creation order even if preflight/start/test fails;
`docker rm -f -v <ownId>` also removes each container's anonymous volumes. There
is no global prune, name-based cleanup or independent volume deletion. Cleanup
failures identify only the affected own IDs and fail the test.

Own rerun on 2026-10-03 around 23:59 UTC:

- `node --check scripts/production-baseline-migrations.test.js`: PASS after fixing
  a local duplicate-variable syntax error during editing.
- Focused four endpoint/identity suites plus baseline suite discovery:
  **169 tests PASS, 4 files PASS, 1 SQL test SKIPPED**; SQL opt-in was unset.
- `npm.cmd run lint`: PASS, 8 existing React warnings.
- `npm.cmd run build`: PASS, PWA generateSW, 78 precache entries, exit 0.
- `git diff --check`: PASS; new SQL/Markdown whitespace checked separately.

SQL assertions have NOT RUN. Prior accepted mock results and independent review
of commit e9f9998 are separate evidence, not a review or SQL PASS of this diff.
No production source, migration, schema, CI, security configuration or credential
file was changed; database fixture SQL has not been executed.

Review correction on 2026-10-04 around 00:09 UTC: the parent reported independent
static review P2 for the missing reservation snapshot and requested ID-based cleanup
plus executable preflight assertions. Those changes are prepared; repeat review
is pending. Own safe rerun: **170 tests PASS, 5 files PASS, 1 SQL test SKIPPED**.
The additional unit test checks preflight rejection of foreign identity/owner,
network, ports, host mounts, named volumes, privileges and unexpected credentials
using synthetic objects without Docker. Node syntax and diff checks PASS.
Lint PASS with the same 8 existing React warnings; build/PWA PASS with 78 precache
entries. An intermediate lint warning about throwing from finally was fixed by
collecting test and cleanup errors and throwing AggregateError after finally.
After that correction the preflight unit was rerun: 1 PASS, SQL 1 SKIPPED, lint
PASS without new warnings. This does not constitute execution of the SQL test.

## Blocker and next task

Docker Desktop is installed but not running; the selected desktop-linux Engine
pipe is absent. Read-only diagnostics confirmed this. Automatic approval review
rejected normal `Start-Process ...Docker Desktop.exe -WindowStyle Hidden` because
startup may activate existing shared containers, databases and ports, conflicting
with the restriction on shared resources. No workaround or second launch was
attempted. No containers or databases were created.

Next task: resolve ownership/autostart authorization for Docker Desktop or use an
already approved isolated executor; inspect local images and container isolation,
then run `QVESTA_TEST_PRODUCTION_BASELINE=1 npm run test -- scripts/production-baseline-migrations.test.js`
(PowerShell: set the process environment variable separately). Do not use the
checkout-documents harness, which reads the shared Supabase database. Keep external
calls, image pulls, shared resources and real orders out of scope.

Acceptance: all existing baseline assertions plus the new committed-claim
fixture/control/three refusal cases PASS; snapshots identical after each refusal
and retry; exactly one dispatch and no application; own container cleaned up;
independent review of the exact diff before any commit. Record actual results and
remaining limitations here. Cloudflare publication hold remains. Proposed parent
status: local SQL persistence test prepared, execution blocked, financial/stage
acceptance partial. Notion had not been changed at that stage.

## Independent repeat review and canonical status — 2026-10-04

Parent reported independent repeat static review **PASS**, P2 closed, exact harness
SHA256 matched: `e705e5e9dc303a69f5719fdb477b918ab365e1c8d43af7e1dd33f41ffaefa355`.
Reviewer actually reran syntax and diff checks PASS and the preflight unit:
**1 PASS, SQL 1 SKIPPED**, with `QVESTA_TEST_PRODUCTION_BASELINE=0`.
These are reported independent results, distinct from the author's reruns above.
Reviewer did not run Docker/SQL or repeat all 170 tests, lint or build.
The earlier pending-review statements describe their dated stages and are
superseded by this result. This documentation-only update does not alter the harness.

Current status: SQL slice implemented and statically reviewed; execution **NOT RUN**.
Full PROD-PAY-04/05 remains in progress with partial acceptance, not Done.
Await the owner's explicit answer permitting Docker Desktop startup despite possible
automatic startup of existing shared containers, databases and ports. The automatic
approval rejection is not bypassed. Cloudflare settings access is also unavailable;
external triggers remain unverified and publication/PR #160 merge hold remains.
No Docker/SQL/commit/push/merge/deploy is authorized by this status update.

Canonical records to synchronize without replacing history:
[PROD-PAY-04](https://app.notion.com/p/3ee511103a9a81a590adc055563a2234) and
[current project status](https://app.notion.com/p/3d7511103a9a81a9b857ddaaa235208f).

Notion synchronization BLOCKED: both pages and the backlog schema were freshly read.
The attempted prepend to PROD-PAY-04 was rejected by automatic approval review,
which treated the original instruction not to change Notion as still binding and
did not recognize the later delegation as its cancellation. No successful write
was confirmed; no retry, alternate write path or project-status update was attempted.
Explicit user approval to update these two canonical Notion pages is required by
that review. Local report update is complete; remote status remains unchanged.

## Isolated SQL execution — 2026-10-04

Docker Engine became available independently; this session did NOT start Desktop.
Standard approved host metadata read succeeded (Engine 29.7.2, Desktop 4.89.0).
The parent assigned execution of the previously reviewed isolated SQL slice.
The reviewed harness hash e705e5e9... matched before execution. Runtime/source,
schema files, security settings, credentials, shared containers and databases
were not changed. The existing migration chain runs only inside the disposable DB.

Cached image metadata (no pull):
- PostgreSQL `supabase/postgres:17.6.1.165`, image ID
  `sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518`.
- Auth `supabase/gotrue:v2.196.0`, image ID
  `sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232`.
- Both declare no volumes. Metadata templates initially errored on missing optional
  Volumes/Tmpfs fields; corrected read-only templates returned null. These were
  formatting errors, not authorization failures or failed SQL assertions.

First opt-in rerun: **FAIL**, 1 SQL failure / 1 preflight-unit PASS, 144.90s total.
The committed fixture and initial snapshot passed, but the positive before_send
control returned `fiscal refund scope denied`. Diagnosis: the test supplied the
original request idempotency command instead of the actual generated request ID.
`subscription_refund_requests.id` defaults to gen_random_uuid independently of
`command_id` (migration `20260925040000_subscription_refund_requests.sql:3`).
Corrected only the harness: validate `claim.commandId` as a UUID and pass that
returned ID to subsequent gateway calls. No assertion was removed or weakened.
This is a test fixture error, not evidence of a product defect.

First-run container IDs:
- DB `40d441836a280e080e4074e9c9f756c77ac89e1c134a9742142187058539245e`.
- Auth `7403656f8ed63ac079bfca2101c503794d670ae19720becbc6c720c72f96ff12`.
Runtime inspect: DB network none; Auth shares only that DB namespace; ports `{}`,
binds null, mounts `[]`; Auth exited 0. Finally completed cleanup; subsequent
label-scoped container listing was empty (exit 0).

Corrected opt-in rerun: **PASS, 2 tests / 1 file, zero skipped, exit 0, 139.25s**.
This is an actual SQL run, not the earlier skipped baseline suite. Command:
`npm.cmd run test -- scripts/production-baseline-migrations.test.js`, process
`QVESTA_TEST_PRODUCTION_BASELINE=1`, own TMP/TEMP cache, approved host execution.
The terminal fixture ran after the existing historical-chain assertions.

| Actual SQL check | Result |
| --- | --- |
| Commit first claim, request/reservation/refund binding, one dispatch, no application | PASS |
| Positive before_send with saved claim key/hash | PASS |
| Expired identity, fresh MFA: SQLSTATE 42501 | PASS |
| Stale MFA, valid identity: SQLSTATE 42501 | PASS |
| Wrong saved hash, fresh identity: SQLSTATE 55000 | PASS |
| New-session 14-table snapshot after every refusal and retry | PASS, identical |
| Status sending/unknown, no review, access not applied for each case | PASS |
| Each retry returns reconcile, same key/hash/firstSentAt, one dispatch | PASS |

Successful-run IDs and runtime evidence:
- DB `91db3746f96fd4d8bbb143a32f2648b28519858219214a1abe9bfcb71eccb63d`:
  network none, PortBindings `{}`, Binds null, Mounts `[]`, Tmpfs `/tmp`.
- Auth `18648fe3ba8ebd762e12b584f402582f047e2e0277be5390fcf8838ee3bfca86`:
  network container with that exact DB ID, PortBindings `{}`, Binds null,
  Mounts `[]`, Tmpfs null, exited 0.
- Harness inspect assertions actually passed, including exact environment matching
  image defaults plus only locally generated Auth settings; values were not logged.
- Finally removed only captured IDs with `rm -f -v`; both exact-ID filters in a
  subsequent container listing returned empty, exit 0. No anonymous volumes existed
  in these images/containers; the anonymous-volume cleanup branch was not exercised.

After the correction: syntax/diff checks PASS; lint PASS with 8 existing warnings;
build/PWA PASS, 78 precache entries. The four endpoint suites were not rerun in
this execution step; their earlier 169 PASS remains separate historical evidence.
No remote Auth/provider/stage/production calls or real financial operations.

Review deliverable: existing three-file uncommitted diff only; harness +145/-14
against HEAD `e9f99981ab1919df2a4eeeeeb85dc391a23a6511`, SQL fixture unchanged.
Harness SHA256 `7b32d112b17664f3fcc68c60c209ccf3ad433f966f290a0f7a541028e00b4868`.
Fixture SHA256 `f2566efc7db475e7b8302197e4dd5ee754b76bd968c97738b00e1c3fe3551634`.
The prior static review covers e705e5e9..., not this command-ID correction; send the
new exact diff and actual execution evidence for independent review before commit.
Notion unchanged; full financial/stage acceptance remains partial and Cloudflare
publication hold remains. No commit/push/merge/deploy.

## Final independent review and local acceptance — 2026-10-04

Coordinator reported final independent reviewer
`01a107fe-cf23-7077-9b0f-b7cf81b7702b` **PASS** on the exact harness SHA256
`7b32d112b17664f3fcc68c60c209ccf3ad433f966f290a0f7a541028e00b4868`.
The reviewer actually reran:
- Baseline including real isolated SQL: **2 PASS, 0 skipped, 132.67s**.
- Unit tests: **149 PASS across 7 suites**.
- Syntax, diff, whitespace, lint and build: **PASS**, 8 existing lint warnings.
- Runtime inspect: DB network none; Auth only in the DB namespace; no ports,
  binds or mounts; cached images. Cleanup of both exact created IDs confirmed.

These are reported independent reviewer results, distinct from the author's
170-test safe rerun, historical 169 endpoint tests and own 2-test SQL run in
139.25s. Do not combine those counts into a new suite or attribute all to one run.
Reviewer container IDs were not supplied in this report; the exact-ID cleanup
confirmation is attributed to the reviewer, not another author inspection.
Anonymous-volume cleanup branch **NOT RUN** because no volumes existed.
Stage, production, provider and full financial acceptance **NOT RUN**.

The coordinator accepted this local slice and authorized a local commit containing
only the harness, SQL fixture and this report on `codex/prod-pay-final-send-tests`.
Before the documentation edit, status showed exactly those three files and an
empty index; both code hashes matched the reviewed versions. No test code was
changed after review. Earlier pending-review/no-commit statements remain history;
the resulting commit SHA and final status are returned in the completion response.
Notion write block and push/PR/merge/deploy hold remain. Full PROD-PAY-04/05 and
production readiness are not closed by this local acceptance.
