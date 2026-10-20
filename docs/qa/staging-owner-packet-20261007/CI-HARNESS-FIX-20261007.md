# Historical CI harness fix — 2026-10-07

No commit, push, merge, deploy, remote SQL, credentials lookup or permissions change. Existing integration changes preserved.

## Cause and correction

Repository: 99 baseline + 225 historical + two feature migrations. Old test excluded account_activity, so the failing comparison was 226 versus 225 (227 late files exist). Normal CI never applied activity. Identity also needs Storage, absent from this harness. The candidate manifest still pinned 324 files.

- `scripts/production-baseline-migrations.test.js`: preserve 99/225 boundaries; require the exact two reviewed release filenames; reject missing/extra/duplicate release versions and missing history; apply all 326 in order, including activity once in both modes. Existing catalog fingerprints, organization preservation, role isolation and SQL/billing checks remain.
- Bootstrap real pinned `supabase/storage-api:v1.70.3` before identity in the newly created network-none DB namespace. No host ports/shared stack/host mounts. Explicit synthetic environment, suppressed diagnostics, startup and real relation checks. Assert private avatar bucket and account_activity RLS. Existing owner-ID/label checks and reverse cleanup cover the new container; no prune.
- `.github/workflows/ci.yml`: pre-pull that Storage image for the `--pull never` test.
- `docs/tasks/PROD-PAY-05-candidate-manifest.json`: count 324 -> 326 and exact chain hash only. Old 324-file chain verified unchanged: `2fd4ceed117ad18b29ea0f4f548e10c0cd40265484230c4cde13a18659f762c7`. Full chain: `122cb2906d65d53e963b0672cc5dcc559367b0593d2113e52d50613deac3dc0c`. SQL candidate hashes, initialization order and `local-candidate-not-deployable` status unchanged.

## Actual validation

- Initial corrected-harness run: FAIL at old manifest guard after Storage/migrations, 2/3 passed; owned containers cleaned. Manifest prerequisite corrected, not bypassed.
- `QVESTA_TEST_PRODUCTION_BASELINE=1 npm run test -- --config .review.local/release-check.vitest.mjs scripts/production-baseline-migrations.test.js`: PASS 3/3, 159.18 seconds. Wrapper changes only dotenv loading. This is the enabled CI historical job test, not the complete workflow; npm ci/audit/all unit/all E2E jobs were not rerun.
- `node scripts/verify-production-candidate-manifest.js`: PASS, 326 migrations and two pinned SQL candidates.
- `npm run test -- --config .review.local/release-check.vitest.mjs scripts/plan-production-billing-package.test.js`: PASS 19/19.
- `npm run lint`: PASS, existing warnings.
- `npm run build -- --config .review.local/final-staging-build.config.mjs --mode staging`: PASS, both receipt/document flags true, public staging client config, dotenv disabled, separate output from owner preview. FINAL-STAGING-BUILD-20261007.json records flags, sole backend project ref and artifact hashes.
- Post-run Docker inventory: no qvesta-release-test containers remain. No unrelated resources removed. `git diff --check`: PASS.

Logs retained in `.review.local`: `ci-baseline-fix.log`, `ci-baseline-fix-rerun.log`, `ci-fix-lint.log`, `ci-fix-manifest-tests.log`, `final-staging-build.log`. The separately gated activity-concurrency mode was not rerun; prior integration coverage remains separate.

## Release composition and gates

RELEASE-COMMIT-SCOPE-20261007.json lists proposed pending commit paths and complete branch-vs-staging release paths. Existing packet-mode edits/generators/receipts are preserved and included for review. Ignored preview helpers/assets/public config and browser state are excluded. Nothing staged or committed.

Independent review reported at 11:19:56 UTC in thread `01a10156-2273-70e5-aee9-772c687f202d`: scoped staging security PASS, full hosted matrix need not repeat. Direct hosted API/Storage denial, expired JWT, malformed authenticated upload and cleanup inventory remain NOT RUN. Production HOLD.

Remaining: review/freeze release commit, exact-SHA remote CI (remote green remains baseline only), then separately authorized staging integration/deployment. Afterwards verify actual artifact/project binding/deployment SHA and app-shell/PWA smoke. Local final flags/build are checked; they do not certify a future Cloudflare artifact. No repeated owner avatar tests needed.
