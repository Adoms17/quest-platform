# Offline P1: actor/profile/quest access candidate

Status: local candidate for independent review. Date: 2026-10-06 UTC.

## Baseline and scope

- Worktree: `M:\Dev\Projects\quest-platform\offline-p1-actor-20261006.local`.
- Branch: `codex/offline-p1-actor-20261006`.
- Base/HEAD: `2834d4561a855f2cee64dce5420fb65e55d0e331`; changes are uncommitted.
- Root checkout remains `codex/workspace-staging` at `d877e74`; its 17 untracked PNG files remain untouched. Final root Git status matches initial status.
- Read repository `AGENTS.md` and handoff template. No `.agents` skills exist in the root checkout or tracked baseline tree.
- Original synthetic reproducer was read from `C:\Users\Алексей\Documents\Codex\2026-10-04\task\offline-review-20261006\review.mjs`. Original findings are reported evidence; the tests below were executed locally against this candidate.
- No secrets, real user records, Supabase CLI/SQL, remote configuration, commits, push, merge or deployment were used.

## Implementation

- `getQuestFromDB` requires an actor and explicit participant profile. It checks that actor's cached server-authorized profile membership before loading the quest, then requires the existing 24-hour participant quest grant before reading assets or creating object URLs. Missing, invalid, future-dated and expired grants fail closed.
- Membership check, grant check and legacy task sanitization share an IndexedDB transaction so sanitization cannot overwrite a concurrent revocation with an older grant.
- `participantProfileAccess` refreshes profiles online and caches only eligible server-provided profiles. Transport failures can use that actor's cache; authoritative empty membership replaces it. Access-denied responses do not fall back to cache.
- A missing URL participant resolves only to a verified self profile, then uses the explicit-profile route. URL parameters, participant-mode labels and old attempts cannot invent membership. The selector's unverified fallback was removed.
- The play screen remounts on actor/quest/profile changes; outstanding loads are aborted and object URLs released. A late profile response cannot write into the next actor's UI or cache.
- Known quest denial on play or package refresh revokes the participant grant. Known unavailable entry status also revokes the grant. Authoritative profile revocation hides the current screen. Offline transport failures retain the existing TTL policy.
- Revocation changes only access metadata. Pending and review events, attempts, permits and media are retained. IndexedDB v15 adds per-profile `participantAccessRevisions` through a non-destructive v14→v15 migration. Server role rules, TTL duration and sync implementation are unchanged.
- Package commit now reads current grants, revisions, old assets and download metadata inside the write transaction after media preparation. A PB refresh cannot restore PA's revoked grant from its old snapshot.
- Play and dashboard capture the profile's revision before server authorization. If a later revocation changes that revision, a delayed response/media download cannot grant access or replace the package. The revocation revision persists even before the first download; a newly authorized request can still restore access. A rejected old response cannot overwrite that newer package.

## Changed files

Runtime:

- `src/services/db.js`
- `src/services/participantProfileAccess.js` (new)
- `src/services/questAccessErrors.js`
- `src/services/participantDashboard.js`
- `src/components/ParticipantProfileSelect.jsx`
- `src/pages/QuestPlay.jsx`

Verification:

- `src/services/db.test.js`
- `src/services/participantDashboard.test.js`
- `src/components/ParticipantProfileSelect.test.jsx`
- `e2e/offline-content-access.spec.js` (new)
- `e2e/app.spec.js`
- `e2e/participant-dashboard.spec.js`
- `playwright.offline-access.config.js` (new)
- This report.

## Validation

All commands run in the candidate worktree, using the existing dependencies; no installation or lockfile change.

| Check | Result |
| --- | --- |
| Baseline `npm run lint` | PASS, existing warnings |
| Baseline `npm run build` | PASS |
| Baseline `npm run test -- src/services/db.test.js src/components/ParticipantProfileSelect.test.jsx` | PASS, 17 tests |
| Candidate `npm run test -- src/services/db.test.js src/components/ParticipantProfileSelect.test.jsx src/services/participantDashboard.test.js src/services/questAccessErrors.test.js` | PASS, 32 tests |
| Candidate `npm run lint` | PASS, same existing React warnings as baseline |
| Candidate `npm run build` | PASS |
| `npm run test:e2e -- --config playwright.offline-access.config.js` | PASS after review changes, 23/23 tests, 52.6 seconds, no page errors |
| Existing `e2e/app.spec.js` and `e2e/participant-dashboard.spec.js`, all three layout projects | PASS, 38 passed / 19 existing skips / 0 failed, exit 0 (6.4 minutes including runner cleanup) |
| `git diff --check` | PASS |
| Live Supabase/RLS, production, payment checks and full unrelated test suite | NOT RUN, outside the authorized local scope |

Browser tests use headless local Chrome, a Vite virtual fixture with `envDir: false`, a synthetic Supabase client, real browser IndexedDB and blocked non-fixture network requests. They cover missing/wrong actor or profile, A/B URLs with and without participant, expired 48-hour grants, owner/supervisor/group-manager access, inactive supervision, online denial, authoritative empty profiles, offline transport fallback, owner refresh/reopen, pending/review/permit preservation across reload, logout/direct account switch, late responses and canceled hydration. Each test checks for uncaught page errors.

The review follow-up adds deterministic media latches for PB-refresh/PA-revoke and PA-refresh/PA-revoke, late same-profile authorization responses with/without an existing package, and v14→v15 recovery across reload. The legacy E2E fixtures now seed verified actor membership and pass the actor to `getQuestFromDB`; the upgrade expectation is v15.

Existing-suite local command: `npm run test:e2e -- --config .review.local/playwright-existing.config.mjs e2e/app.spec.js e2e/participant-dashboard.spec.js`. The retained local wrapper imports the repository config, keeps its desktop/Android/iPhone-layout projects, selects installed Chrome, and starts `npm run dev` on dedicated port 4187. It only adapts the runner for this worktree's shared dependencies and does not change product or security settings. Backend endpoints use the existing synthetic test responses; real Supabase/edge integration tests retain their existing skip gates.

The 19 skips are 15 backend-integration cases across the three projects, plus two duplicate migration and two duplicate cancellation checks on the same Chromium engine. The migration and cancellation tests both ran successfully in the desktop project. These skips are not reported as executed passes.

Earlier runs: the first browser run passed 11/13; two assertions expected internal TTL error text instead of the existing generic UI message. Assertions were corrected and direct reader rejection checks added. A later 16/16 run exposed an unhandled rejection in the synthetic transport stub; the stub was fixed and page-error assertions added. The subsequent strict 16/16 run passed without page errors. These were test-fixture corrections, not ignored product failures.

Independent review subsequently confirmed the previous 32-unit/18-browser result but reported a real P1 stale snapshot overwrite in `saveQuestToDB` and P2 obsolete existing-E2E reader calls. Those findings motivated the transaction/revision guard and fixture changes above; the earlier 18-test pass did not cover that race.

## Environment and cleanup

Initial sandbox Git write failed with `Permission denied`. The exact worktree creation succeeded through approved `require_escalated`. Git inspections also used that mechanism because sandbox and owner accounts differ. No ACL, ownership, `safe.directory` or other security setting was changed. Code edits and local tests ran through the normal executor.

The new synthetic suite closed its browser contexts and Vite server in teardown. The existing suite completed all cases but hung while stopping its own Vite process. Approved read-only inspection identified PID 18216 and port 4187; `Stop-Process` returned an internal error, so approved `taskkill /PID 18216 /F` terminated that re-verified task-owned server. The runner then exited 0 with 38 passes and 19 skips. No unrelated process was terminated and no security setting was changed.

No remote resources or database containers were created. Worktree and local generated `dist`, `test-results`, `.offline-vite-cache.local`, `.review.local/existing-results` artifacts are retained for review; no user data was deleted. Existing unrelated worktrees/processes were not changed. In-flight sync was not inspected because no sync code was touched.

Next step: independent review of this uncommitted candidate and its synthetic regression suite. Offline access necessarily relies on the last verified local membership and the existing grant TTL until the server can be reached; no live backend acceptance is claimed.

The complete tracked-and-new-files diff is exported to `.review.local/candidate.patch` in this worktree. Apply only to the stated baseline in a separate review checkout; no commit has been created.
