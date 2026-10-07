# Local integration candidate: offline, profile identity, account activity

Worktree: `M:/Dev/Projects/quest-platform/integration-offline-profile-activity-20261006.local`.
Branch: `codex/integration-offline-profile-activity-20261006`.
Base: `2834d4561a855f2cee64dce5420fb65e55d0e331`.

All three source worktrees were clean before integration and remained unchanged. The root checkout and its unrelated PNG files were not modified. Root AGENTS.md was read; no tracked `.agents` skills were present. The six requested commits were cherry-picked without textual conflicts:

| Source | Integrated SHA |
| --- | --- |
| `5035237bff29f06ca93b0a1c9bdcac9ec6f798a0` | `5a044c8ffcdaf994057464e8fe78737d1fedcb33` |
| `47ed00a0cc5afefc7e81491ddf3d1cf352f01dda` | `7980a431998ef62fb7ca30ab5194106a88ee8cf5` |
| `3056f4036c6d379b7df42d0d37ec6645b66e4c0d` | `fa1aa900c701fda1d379e67b287e87c2ba8dd19c` |
| `a9b90f47cfa3f0947f52dc423c50ae3ef808662e` | `490ae687e3fa0facb5669e24d9d196668f66c410` |
| `86789938c2019c92f7aeea38927fee703e556a8e` | `0d63c8141e6d8cbc8c1fef8db46cbd637f99609a` |
| `a57cbb2b0a3cbf846829209d7e1ffff55de5bf53` | `a4d7c3e4f2cb400dae047c9dfc9932d295bf6e5a` |

## Integration decisions

- App installs account activity once by authenticated user ID. Same-account token refresh does not reinstall the hook; account switch aborts its previous observation. Activity remains best effort and does not use the offline event queue.
- Profile card and group members remount on actor/profile or actor/group changes; avatar cleanup revokes object URLs. Identity editing retains server authorization and revision checks. Curator wording does not change stored role names.
- QuestPlay retains actor/profile gating, membership verification, grant TTL and cancellation. Nickname/avatar metadata does not grant quest access. The real browser fixture now mounts the activity hook alongside QuestPlay and checks nickname editing, A/B activity isolation and pending recovery together.
- Migration order is the 324 historical migrations, real Storage schema initialization, `20261006010000_participant_profile_identity.sql`, then `20261006020000_record_account_activity.sql`. Both new migrations coexist successfully; account activity does not redefine profile or quest authorization functions.

Additional integration changes are test-only: `scripts/offline-actor-acceptance.test.js` initializes real Storage and runs the focused SQL suites; `scripts/verify-account-activity.js` accepts explicit Docker client arguments for its concurrent sessions; `e2e/fixtures/offline-real-backend.jsx` mounts the activity hook; `e2e/offline-real-backend.spec.js` adds the cross-feature scenario. This report is the fifth integration-specific file. No additional production source, migration, dependency, lockfile, role, TTL or Supabase configuration change was made beyond the requested commits.

## Validation

- PASS: 119 tests across 14 targeted unit files for offline access, identity components/data layer/PNG endpoint, account activity and cleanup.
- PASS: 29 tests across six additional files for curator terminology, invitations, authSession, syncCoordinator and profile labels. Total targeted unit tests: 148.
- PASS: two real Chrome/synthetic-boundary suites, using `QVESTA_TEST_ACCOUNT_ACTIVITY_BROWSER=1 QVESTA_TEST_PARTICIPANT_BROWSER=1` with `npm run test -- scripts/account-activity.browser.test.js scripts/participant-avatar-browser.test.js` (PowerShell environment assignments).
- PASS: `npm run test:e2e -- --config playwright.offline-access.config.js`, 23/23 browser regressions including TTL, account switch, delayed refresh/revocation and IndexedDB v14-to-v15 preservation.
- PASS: `npm run lint` with existing React warnings; `npm run build`.
- Real backend command: `$env:RUN_ISOLATED_OFFLINE_ACCEPTANCE='1'; npm run test -- scripts/offline-actor-acceptance.test.js`. It uses only fresh owner-labeled Postgres/Auth/Storage/PostgREST containers, synthetic accounts, a dedicated network and loopback published ports. No shared Supabase stack or remote service is used. Vite does not read env files; dependencies are reused without installation.
- Initial combined backend run: all 326 migrations, five profile pgTAP suites (48 + 28 + 20 + 31 + 8 assertions), account activity pgTAP (21 assertions) and its concurrent-write tests, and five browser scenarios passed. Overall harness FAIL because Docker cleanup did not acknowledge Postgres/network removal within the configured step execution. The failure receipt is retained at `.review.local/integration-first-cleanup-failure.json`. Subsequent owner-filtered Docker inventory confirmed no resources remained. The final rerun uses bounded 20-second Docker commands / 45-second resource steps rather than 10/25 seconds and adds the sixth cross-feature browser scenario.

NOT RUN: production/staging/remote acceptance, full avatar Edge/Kong HTTP lifecycle, unrelated billing scenarios and full test suite. The historical production-baseline harness was not run: it hard-codes 225 post-baseline migrations and does not initialize Storage required by the new profile migration. The combined isolated runner above supplies the relevant migration/SQL/RLS coverage without that billing workflow. The previous report's 19 skips are preserved as historical SKIP, not converted to passes; full multi-layout existing suites were not repeated here. No native Safari or hosted-platform equivalence is claimed.

Final combined rerun PASS: 326 migrations, all six SQL/RLS suites (156 assertions total), account activity concurrent-write checks, and 6/6 real browser cases (19.1 seconds; complete harness 109.07 seconds). Evidence start `2026-10-06T21:05:41.572Z`, finish `2026-10-06T21:07:29.848Z`, owner `qvesta-offline-313bbd11d6f3485ab93b2e9b18eee2d2`. `.review.local/offline-auth-evidence.json` confirms Vite/proxy closed, four containers and the dedicated network removed, `cleanupErrors: []`, `runFailed: false`. Owner-filtered Docker inventory independently confirmed absence after teardown. No remaining resource cleanup blocker.

## Release boundary

Update 2026-10-07: DB/Edge deployment, Cloudflare mapping and basic owner authenticated UI smoke have since completed. The paragraph below records the historical local-integration boundary. Current evidence, remaining CI/security gates and working state are in [the release checklist](staging-owner-packet-20261007/RELEASE-CHECKLIST-20261007.md). Owner UI observations are not direct API denial assertions or full adversarial acceptance.

This is a local candidate for independent review, not a staging-ready release. Backup/audit, Cloudflare mapping and security approvals remain open, as do the profile release blockers documented in the source branch. No push, merge, deployment, remote SQL, Supabase CLI operation or security-setting change was performed. Candidate worktree and ignored evidence/build caches are retained for review.
