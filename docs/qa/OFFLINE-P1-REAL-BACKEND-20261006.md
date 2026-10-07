# Offline P1: isolated real backend acceptance

This follow-up validates committed candidate `5035237bff29f06ca93b0a1c9bdcac9ec6f798a0` on branch `codex/offline-p1-actor-20261006`, based on staging `2834d4561a855f2cee64dce5420fb65e55d0e331`. It supersedes only the earlier report's NOT RUN status for the local Auth/RLS/sync scenarios listed below. Production code is unchanged in this follow-up.

## Setup and scope

The gated Vitest harness creates a fresh PostgreSQL database, real GoTrue Auth and PostgREST using cached Docker images. It replays all 324 repository migrations, checks that no cron jobs are active, and runs browser tests against the real HTTP services. A loopback proxy adapts their URL prefixes and CORS; it does not mock responses. JWT signing material and synthetic credentials are generated for each run and are not retained in the report. Browser user tokens come from real Auth. REST requests execute through the authenticator role and actual RLS policies.

The dedicated network and all three containers have a unique owner label. Only Auth and REST publish ports, bound to 127.0.0.1; PostgreSQL has no host port and uses temporary data. Docker Desktop did not publish ports on an internal-only network, so the harness uses a dedicated bridge. No shared Supabase stack, remote project, real accounts, Supabase CLI, billing scenarios or security-setting changes were used. Vite uses `envDir: false` and ephemeral configuration. No dependencies were installed.

Run from the candidate worktree in PowerShell with authorized Docker access:

```powershell
$env:RUN_ISOLATED_OFFLINE_ACCEPTANCE='1'
npm run test -- scripts/offline-actor-acceptance.test.js
```

## Results

Initial successful run: 2026-10-06 20:42:33 UTC, Vitest exit 0, one harness test passed, five Chromium browser tests passed in 14.8 seconds (whole harness 86.36 seconds). The original Vitest output `23:42:33` was Windows local time (UTC+03:00), incorrectly labeled UTC in the first report. Verified against the host's explicit `Get-Date -Format o` offset and the evidence file's `LastWriteTime` 23:43:59 / `LastWriteTimeUtc` 20:43:59. New evidence records explicit ISO UTC start and finish timestamps.

| Check | Result |
| --- | --- |
| Fresh migration replay | PASS, 324 migrations |
| Existing authorized complete offline attempt, synchronization and duplicate prevention | PASS |
| Existing authorized quest completion through participant UI | PASS |
| Private quest: A reads offline, synchronizes two events exactly once; B cannot read A's quest, attempts, receipts or pending events | PASS |
| Switch A to B while real submit RPC is in flight; pending ownership preserved; A later resumes with exactly two receipts | PASS |
| Real organizer grant revocation: refresh and sync rejected with 42501, cached content unavailable, pending unchanged | PASS |
| `npm run lint` | PASS, existing React warnings |
| `npm run build` | PASS |
| Production/remote acceptance, edge services, unrelated backend cases and billing | NOT RUN |

In-flight behavior: the delayed request already carries A's token and may complete as A. A subsequent request under B is denied with 42501; A's unconfirmed event remains pending. Re-login as A completes recovery without duplicates. This test proves isolation and preservation; it does not claim that logout cancels an already issued authenticated request. No sync implementation was changed.

The prior 19 skips are not relabeled as passes. Two relevant existing scenarios were executed once in Chromium with this real backend, together with three new focused cases. Other backend scenarios and repeated layout runs remain outside this follow-up. Missing/wrong profile, TTL expiry, stale hydration, media races, migration recovery and review-result preservation retain their earlier synthetic/unit coverage; they were not all repeated against real Auth here.

Earlier harness runs failed due to Docker internal-network port publishing, Auth database search_path, and proxy CORS header setup. These infrastructure errors were corrected; every completed failed run cleaned up its owned resources. They are not counted as product passes.

## Deliverables and cleanup

New files only:

- `scripts/offline-actor-acceptance.test.js`: isolated service lifecycle and migration runner.
- `scripts/offline-acceptance-cleanup.js`: independent bounded teardown and final receipt, preserving the original error.
- `scripts/offline-acceptance-cleanup.test.js`: resource-free failure injection for rejection, hang, ownership mismatch, Docker removal failure and receipt failure.
- `playwright.offline-real.config.js`: five selected browser cases, one worker, no trace/video/screenshots.
- `e2e/fixtures/offline-real-backend.jsx`: synthetic accounts, actual grants/downloads and actual application services.
- `e2e/offline-real-backend.spec.js`: three real backend regressions.
- This report.

The initial successful run recorded migration replay PASS, browser acceptance PASS, all three containers and the dedicated network removed, `cleanupErrors: []`, with owner `qvesta-offline-bd0e6c328160481a86fd3ffa1dc7a3cc`. The latest run replaces `.review.local/offline-auth-evidence.json` with its own owner and UTC timestamps.

Review correction: Vite close, proxy connection close, proxy server close, every container and the network now execute as independent bounded cleanup steps. Docker cleanup uses asynchronous processes with a 10-second command timeout; resource steps allow 25 seconds for inspect and removal, other steps allow 5 seconds. Each removal rechecks the exact resource ID and owner label. Rejections and timeouts are accumulated without skipping later resources or the receipt attempt. An original run error is rethrown unchanged when cleanup succeeds, or retained as the cause and first error of an AggregateError when cleanup also fails. A timeout cannot guarantee a failed resource was removed: the receipt marks it unsuccessful and the run fails. Receipt write failure is also surfaced instead of reporting successful cleanup.

Review rerun: `npm run test -- scripts/offline-acceptance-cleanup.test.js` PASS (4 tests; no real resources created). The gated real acceptance command above PASS (5 browser scenarios, 16.7 seconds; harness 89.27 seconds). `npm run lint` PASS with existing warnings; `npm run build` PASS. New evidence records start `2026-10-06T20:51:22.672Z`, finish `2026-10-06T20:52:51.182Z`, owner `qvesta-offline-91361e599cc045f7bce1555d307d013a`, all seven teardown steps successful, `cleanupErrors: []`, `runFailed: false`. This review correction changes only the harness, cleanup helper/tests and this report; the browser scenarios and production candidate remain unchanged.

The new uncommitted diff is exported separately as `.review.local/real-backend-acceptance.patch`; the previously reviewed candidate patch is preserved. Local reports/build output and the candidate worktree are retained. No commit, push, merge or deploy was performed in this follow-up.
