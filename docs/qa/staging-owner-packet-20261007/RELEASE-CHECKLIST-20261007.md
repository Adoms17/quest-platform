# Integration staging release checkpoint — 2026-10-07

Scope: offline actor isolation, profile identity/avatar, account activity; staging frontend only. Supersedes earlier blanket NOT RUN / missing mapping statements. No push, merge, deploy, remote SQL or permissions change in this checkpoint.

## Candidate and working state

Worktree: `M:/Dev/Projects/quest-platform/integration-offline-profile-activity-20261006.local`; branch `codex/integration-offline-profile-activity-20261006`; HEAD `3623811903bc3b7019ba97e17999a9bfda6c9d12`; app candidate `8c9ae161d6a9d2a9c51be2940a14d945128752eb`.

GitHub read-only lookup: remote staging remains `2834d4561a855f2cee64dce5420fb65e55d0e331`; candidate is 8 commits ahead. App/admin source, functions, migrations, package and lockfile have no differences from the app candidate.

Preserved existing dirty work: packet-mode changes in `scripts/offline-actor-acceptance.test.js`; untracked owner packet and five helpers: `build-staging-history-diagnostic.mjs`, `build-staging-owner-packet.mjs`, `build-staging-preflight-summary.mjs`, `staging-history-diagnostic.test.js`, `verify-staging-owner-packet.js`. These are QA/release support, not product changes. Review their inclusion in the eventual release commit; do not add ignored preview artifacts blindly.

## Completed evidence

- [x] Backend-first: owner DB catalog postcheck PASS (328 migration IDs and expected assertions); avatar Edge v1 ACTIVE, JWT required, downloaded source hashes match.
- [x] Gateway/no-auth and CORS checks; loopback OPTIONS returns 204 with exact origin and required headers.
- [x] Basic owner authenticated UI smoke: save/reload, replace/reload, remove while retaining nickname; unrelated B denied A profile details/avatar/editor. [Exact receipt](edge/OWNER-AUTHENTICATED-SMOKE-20261007.json). Do not ask the owner to repeat these steps.
- [x] Both staging Workers' repository/branch/commands/filters/domains recorded as [owner UI evidence](edge/CLOUDFLARE-OWNER-MAPPING-20261007.md). Current public artifacts reference staging; this does not attest future build-time variables.
- [x] Local candidate build and lint PASS with existing warnings; built staging target verified, dotenv disabled. Loopback build omitted VITE_SANDBOX_RECEIPTS and is not final release-build parity evidence.
- [x] This checkpoint reran seven focused mocked unit files: 76/76 PASS for identity editor/avatar/API/preparation, activity service/hook and avatar endpoint. No remote data or sessions used.

Prior isolated SQL/RLS/concurrency/browser coverage is reported in the integration report (156 SQL assertions, six browser cases and offline regressions); it is not hosted adversarial evidence. Current `.review.local/offline-auth-evidence.json` now contains the later successful owner-packet run at 09:41–09:42 UTC and proves packet checks/cleanup only. Do not cite it as the raw receipt for the earlier full integration run. That result remains recorded in the historical report.

## Remaining gates

1. **Exact release commit and CI: OPEN.** Candidate is not on GitHub: exact HEAD check-runs lookup returns 422, commit not found. Baseline green checks do not validate it. Baseline has successful Workers Builds for both Workers, CodeQL actions/javascript and [Admin CI](https://github.com/Adoms17/quest-platform/actions/runs/37384176873). [Baseline analysis run](https://github.com/Adoms17/quest-platform/actions/runs/37384176331). General CI runs on PRs to staging, not staging pushes. Branch-protection API reports “Branch not protected”; rulesets were not exhaustively checked and this does not justify skipping CI.
2. **CI harness correction: local PASS.** The old harness excluded account_activity, leaving 226 late files against 225 expected (227 exist in total). It also lacked Storage bootstrap and the CI manifest still pinned 324 files. The correction preserves 99 baseline + 225 historical assertions, requires exactly the two reviewed release filenames, applies all 326 in order, and bootstraps real pinned Storage in the network-none disposable DB namespace. Old 324-chain SHA is unchanged; the manifest pins the full 326-chain SHA. No checks are skipped. Full CI-equivalent historical test PASS 3/3 (159.18 seconds), manifest/package tests PASS 19/19; see [CI-fix report](CI-HARNESS-FIX-20261007.md). Exact published-SHA CI is still required.
3. **Scoped staging security: reviewer PASS.** Independent read-only review in thread `01a10156-2273-70e5-aee9-772c687f202d`, reported at 2026-10-07 11:19:56 UTC, accepts exact source hashes, owner DB 328 IDs, existing real local Storage/Auth/SQL adversarial QA, hosted gateway/CORS and owner lifecycle evidence for this scoped staging release. Repeating the full matrix on hosted staging is not required by that review. Direct hosted API/Storage denial, expired JWT, malformed authenticated upload and cleanup inventory remain NOT RUN; no full adversarial PASS is claimed. Production remains HOLD. Completed owner checks need no repetition.
4. **Final artifact and deployment: partially checked locally.** A separate local staging build now enables both receipt/document flags and verifies the sole project ref jeugfyaqzfgdvfhdxfht in assets; see FINAL-STAGING-BUILD-20261007.json. Freeze release SHA and review eligible ref/auto-build effects. Both app and admin may rebuild due to migration changes. After separately authorized publication, verify actual live project binding, artifact/deployment SHA and app-shell/PWA behavior. Existing Cloudflare version IDs are rollback references; do not down-migrate DB or delete Storage.

Deno type-check remains NOT RUN in the preparation report; deployed runtime and owner lifecycle are runtime evidence, not a type-check. Backup restore remains untested and Storage bytes excluded from the recorded DB backup. Full production/billing acceptance is outside scope.

## Next sequence and lifecycle

Review QA-only changes and the CI fix/results. Scoped staging security is accepted with the NOT RUN limitations above. In a subsequently authorized turn, freeze/publish a candidate branch for PR CI (staging preview builds OFF), obtain exact-SHA checks and review, then proceed to staging integration/deployment and post-deploy smoke. No publication in this checkpoint.

Preview PID 17092 remains reserved until scheduled expiry at 14:35:19 UTC. Stop only after confirming PID ownership: `Stop-Process -Id 17092`. Owner browser storage was not inspected. Keep the owner's remaining nickname and accounts intact. Local evidence/caches remain for review.
