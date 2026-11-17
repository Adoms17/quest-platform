# Account last activity — local review candidate

Date: 2026-10-06 UTC. No commit, push, migration application or deployment.

## Baseline and scope

- Worktree: `M:\Dev\Projects\quest-platform\account-last-activity-20261006.local`.
- Branch: `codex/account-last-activity-20261006`.
- HEAD/base: `2834d4561a855f2cee64dce5420fb65e55d0e331`.
- Read AGENTS; initial status clean. Dedicated worktree created after the sandbox Git lock denial, through approved escalation. Other worktrees were not edited.
- Searched baseline src, migrations and SQL tests for last_activity/last_active/last_seen/last_sign_in. Existing `quest_attempt_activity.last_activity_at` describes attempts, not accounts. No suitable account field was found.

## Chosen semantics for review

`last_activity_at` is the server observation time of foreground use of the main authenticated PWA. A visible opening with a newly signed-in or restored session qualifies. A session restored in a hidden tab qualifies on its first visible display. Subsequent trusted pointer-down (mouse/touch/pen) or non-repeated keyboard input qualifies. Modifier-only input, mouse movement, passive scrolling, background polling, token refresh, sync and network reconnection do not qualify. Visibility changes after that first opening do not alone qualify.

This is an engagement observation, not proof of a completed business transaction or presence of a particular human. Trusted browser events avoid synthetic UI events but an authenticated client can call its own RPC directly. No keys, text, coordinates, event types or payloads are transmitted or logged. One integration hook in App depends on user ID only, so same-account token refresh cannot restart observation. Cleanup aborts outstanding calls and removes listeners on logout/account switch.

The main PWA includes its organizer and participant routes. The separate admin application and public website are outside this candidate. Activity performed on behalf of a dependent profile belongs to the authenticated actor account, not the child/profile. This does not change profile control, roles or grants.

## Storage and throttling

Migration adds one row per observed account to `public.account_activity`, with primary key `account_id` and only one timestamp `last_activity_at`. It is separate from profiles to avoid inheriting their existing read/write permissions. RLS permits authenticated accounts to read only their own row; direct client insert/update/delete are denied.

`record_my_account_activity()` has no arguments. SECURITY DEFINER with an empty search path uses `auth.uid()` and `now()`; a missing UID is denied. Atomic INSERT/ON CONFLICT updates only if at least 24 elapsed hours have passed, including concurrent calls. This is a rolling 24-hour interval, not a calendar-day boundary. It returns remaining server seconds before the next eligible write; the client throttles using a monotonic clock. Reloads or another device can make additional RPC reads/no-ops, but cannot bypass the server write limit.

No timer, heartbeat, cron, offline queue, historical backfill, cleanup policy or self-delete is introduced. Failures are silent and suppress further attempts for five minutes within that mounted session; another qualifying action is required after that interval. Existing rows are not initialized on signup. An absent row means UNKNOWN, not inactive. The foreign key cleans up this metadata if an account is deleted by an independently authorized existing process; this candidate does not initiate deletion.

## Accuracy and a future retention decision

For successfully observed online use, daily coalescing can make the stored date almost 24 hours earlier than the last qualifying action. Network failures, offline use, old clients, separate admin use or passive reading can make the gap larger and unbounded. Server receipt time does not reconstruct historical offline activity.

Do not use this field alone to delete accounts. A future policy must separately define a retention period R, notifications/grace, legal/product exclusions, unknown-date handling and coverage of other clients. A conservative candidate cutoff is older than `now() - R - 24 hours`, but this buffer only covers coalescing and does not solve unknown/offline observations. Unknown dates must not automatically enter a deletion cohort, and rollout must not be treated as historical evidence. No retention duration is selected here.

## Files

- `src/App.jsx`: one hook integration.
- `src/hooks/useAccountActivity.js` and `.test.js`: actor lifecycle.
- `src/services/accountActivity.js` and `.test.js`: own RPC and foreground coalescing.
- `supabase/migrations/20261006020000_record_account_activity.sql`.
- `supabase/tests/database/account_activity.test.sql`.
- `scripts/production-baseline-migrations.test.js`: scoped account-activity opt-in branch using the existing isolated baseline and owner-checked cleanup.
- `scripts/verify-account-activity.js`: pgTAP and independent-session concurrency checks.
- `scripts/account-activity.browser.test.js`: headless installed Chrome and synthetic RPC fixture.
- This report.

## Validation

- PASS: `npm run test -- src/services/accountActivity.test.js src/hooks/useAccountActivity.test.js src/services/authSession.test.js src/effects.test.jsx` — 21 tests, 4 files.
- PASS: `npm run lint` — warnings in existing unrelated React components, no errors.
- PASS: `npm run build` — exit 0, Vite and PWA completed, 78 precache entries.
- PASS: `git diff --check` for tracked diff; new files reviewed directly.
- PASS: `QVESTA_TEST_ACCOUNT_ACTIVITY=1 npm run test -- scripts/production-baseline-migrations.test.js` (PowerShell uses the process environment variable). Final rerun: 2 Vitest tests, 70.83 seconds, exit 0. Existing 324 historical migrations and fresh GoTrue Auth schema precede this candidate migration. The account branch stops before unrelated billing acceptance scenarios.
- SQL/RLS: 21 pgTAP assertions PASS. No backfill, RLS, anonymous/missing-UID denial, zero RPC arguments, server time, repeat/12-hour/exact-24-hour behavior, direct write denial and A/B read isolation were exercised in PostgreSQL.
- Concurrency PASS: first insert, fresh repeat and expired update each use a holding transaction plus six competing independent psql sessions. The harness observes PgSleep and lock waits, then asserts all sessions succeeded and a test-only trigger counted exactly one physical write for insert/update and zero for fresh repeats. A second account records independently. The counter exists only in the disposable test database; no product event history was added.
- PASS: `QVESTA_TEST_ACCOUNT_ACTIVITY_BROWSER=1 npm run test -- scripts/account-activity.browser.test.js` — final 1 browser integration test, 25.54 seconds, exit 0. Installed Chrome, real trusted pointer/keyboard events, real offline network state, production hook/service and synthetic RPC responses. Covered foreground sign-in/restored identity, same-account token-like rerender, no timed heartbeat/reconnect/synthetic event recording, trusted interaction after eligibility, frozen/active browser lifecycle, request failure/backoff/later successful interaction, logout/account switch with cancellation and late response, reload. A controlled monotonic clock avoids waiting 24 hours; no real Auth/provider backend is used by this browser fixture.
- Browser limitation: the initial attempt to assert native hidden-tab visibility FAILED because this headless Chrome remains `visible` when switching/minimizing tabs. This was not ignored or called PASS. The final test uses Chrome's actual frozen/active lifecycle without overriding document.visibilityState. Native hidden-tab behavior is still only covered by the unit visibility fixture and needs a suitable headed/manual environment if required for acceptance. Frozen is not claimed to prove hidden visibility.
- Full unrelated suites and live backend acceptance NOT RUN. No dependencies/lockfile changes, secret reads, Supabase CLI or remote operations.

## Isolation and cleanup evidence

The authorized Docker run used only local images (`--pull never`), unique owner-labelled containers, PostgreSQL network `none`, Auth migration in that same isolated namespace, no published ports or host bind mounts, and synthetic generated credentials kept out of output. Preflight checks image environment inheritance, privileges, network and mounts. No shared local Supabase stack was accessed. Container IDs originate only from this invocation's successful creates; cleanup rechecks ID and owner label before removing those containers and their anonymous image volumes. Cleanup errors fail the run, including the account-only branch. Both actual SQL runs exited 0; the second verifies the final cleanup structure. No runtime security settings were changed.

The first Docker inspection hit sandbox access denial; the explicitly authorized isolated run used approved escalation. The baseline harness's initial follow-up introduced two finally-control-flow lint warnings; restructuring the account-only branch removed that early return and retained normal failure aggregation. Product runtime code and migration did not change during this validation follow-up.

Chrome/Vite close in finally. Only worktree caches, dist and review artifacts remain. The offline/failure uncertainty described above remains: missed activity is not reconstructed or used as authority for deletion.

Next: independent review of the local candidate. The requested SQL/RLS/concurrency and trusted-event checks now have executed evidence; native hidden-tab behavior has the explicit limitation above. No commit or publication is authorized by these checks, and there is no production Go.
