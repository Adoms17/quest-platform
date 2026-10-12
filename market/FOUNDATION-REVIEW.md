# Market public cover/demo foundation — local review

Baseline: `220ce8bd660ef860c29500775cbd4fc911010a28`, user-verified HEAD and recorded by the user's manual runner. Worktree: `M:/Dev/Projects/quest-platform/market-public-foundation.local`; branch name previously reported: `codex/market-public-foundation-20261012`. User-provided Git evidence at 2026-10-12 17:21 UTC confirms only 17 untracked files and empty `git diff --stat 220ce8bd660ef860c29500775cbd4fc911010a28`; tracked baseline preservation is verified from that evidence, not an executor Git rerun. Source: `Sentinel_765334e848bc8191982d9e9ebf4e5cc4`. Executor ordinary Git remains blocked by dubious ownership. No trust/ACL/permission overrides, commits or publication. This reconciliation edits only this report and the manifest.

## Review correction: licensed attribution and evidence

The P2 finding is fixed in `publicExtrasContract.js`: `licensed` requires attribution with at least one non-whitespace character. No exception model is implied. Both cover and demo use the same fail-closed review validator. Other rights bases retain their previous behavior. Added four parameterized negative UI/validator cases for empty string, space, tabs/newlines and Unicode whitespace, plus one positive case requiring attribution to be displayed for both components. Invalid licensed cover/demo expose neither image nor question/options.

`qa/verify-foundation.mjs` no longer sets any Git trust override or unconditionally asserts validation PASS. `qa/run-foundation-checks.mjs` saves actual stdout/stderr, command, cwd, UTC start/end timestamps, exit code, expected baseline, verified commit (null when Git refuses), and SHA256 of relevant inputs/logs. The manifest derives status from those receipts and verifies log and input hashes. It labels Git and tracked-ref comparison unavailable rather than borrowing the previous run's result. Local source/payload SQL hash checks remain possible without Git.

Earlier correction edits: validator, unit/UI tests, evidence verifier, new evidence runner, this report, regenerated manifest and saved `qa/review-fix` logs/receipts. The 17:21 UTC user-provided Git evidence now confirms no tracked changes against the exact baseline. This executor does not claim an independent Git rerun.

## Delivered scope

Four new, currently unreachable runtime modules: `publicExtrasContract.js`, `PublicCoverCandidate.jsx`, `PublicDemoCandidate.jsx`, `publicExtrasCandidate.css`. They are imported only by tests. User-provided status and empty baseline diff establish preservation of tracked production entrypoint, catalog adapter/DTO, routes, public assets, exporter, SQL, sales policy and release configuration. Production build contains none of the candidate/fixture markers checked by `foundation-manifest.json`; that scan is separate evidence, not the basis for baseline file equality.

Synthetic records live under `tests/`, explicitly marked test-only. They describe a triangle teaching question and a nonexistent test image; no compass-to-product mapping, real product or commercial asset is implied. Browser harness is a separate test HTML entry, absent from the production build. Candidate UI renders only records with exact keys, the expected published product/version identity and an approved-shaped public review attestation. The attestation is not proof of rights: a future trusted publisher must perform and enforce the actual review before issuing it.

Cover: exact same-origin `/assets/public-covers/<sha256>.<png|jpg|webp>` path, MIME/extension/digest consistency, bounded dimensions and required alt text. Non-whitespace attribution is mandatory for `licensed`; other rights bases retain their existing optional-attribution behavior. No URLs, SVG, query strings, signed links or private data-URL snapshots. Missing/invalid records render a fallback without a request; load failure removes the image. Record changes reset the error state.

Demo: separate `independent-single-choice` record with UUID identity, immutable revision, content digest, bounded plain-text fields, two to six unique option IDs, explicit public correct option, per-choice feedback and explanation. Comparison is exact option-ID equality; text normalization is intentionally unsupported. React escapes all text. State is local; empty submission focuses the first option, reset focuses it again, changing record/version resets state, withdrawal removes content. The caller owns navigation through `onReturn`; the test harness demonstrates focus restoration. Existing live version-pinned navigation has not been rewired.

## E1 source and exact SQL architecture

Read-only source: `M:/Dev/Projects/quest-platform/fiscal-recovery-evidence-e1.local`. Historical investigation reported six untracked SQL files matching the tracked package at `9da42e406406abd2538dabda1cb9c38b5a7c240d` (`shop-schema-stage-six`). Current ordinary Git cannot reverify that claim. Current source/payload/manifest byte comparisons are recorded separately in the regenerated manifest; tracked comparisons are null. The previously reported tracked SQL location is `docs/qa/shop-schema-runner/package/payload/`.

Local Session-pooler package: `docs/qa/shop-schema-session-pooler/package/`. Its `package-hashes.json` SHA256 is `d989a519ae22ad2f7913898997d7b7c0b92586359e0bb81a9341444968e31f2c`, equal to the tracked package and Apply194 report. All six source/payload/tracked hashes and manifest entries match. The report, receipt JSON, postcheck SQL and screenshot hashes match Apply194 `final-hashes.json`. Full individual hashes are in `foundation-manifest.json`. This is a scoped six-migration byte check, not a fresh verification of all 335 historical SQL bodies.

Apply194 report links to `https://github.com/Adoms17/quest-platform/actions/runs/38171603970`, Preview193 to `https://github.com/Adoms17/quest-platform/actions/runs/38171214039`. These URLs and the recorded SHA/package were checked against saved evidence; remote pages were not opened. The saved postcheck reports 335 ledger versions, 13 Shop tables, zero Shop RLS failures and zero client TRUNCATE grants. These are **reported remote results**, not rerun DB acceptance.

| Migration | Role relevant to this decision |
| --- | --- |
| `20261010010000_shop_acquisitions_and_lineage.sql` | Products, immutable quest/task snapshots, acquisitions and copy lineage. `capture_shop_material` verifies supplied bytes/SHA and MIME, embedding private data URLs. `publish_shop_quest_version` captures source quests/tasks, not public editorial content. |
| `20261010020000_shop_orders_and_fulfillment.sql` | Offers/orders, trusted payment facts and fulfillment/copy issuance. Not a source of demo answers or cover rights. |
| `20261010030000_shop_order_screen_reads.sql` | Organization-authorized offer/order projections. Separate from anonymous Market. |
| `20261010040000_shop_payment_attempts.sql` | Payment contracts/attempts and guarded checkout operations; unchanged. |
| `20261010050000_shop_payment_reconciliation.sql` | Reconciliation jobs/claim/finish/attention operations; unchanged. |
| `20261010060000_shop_public_catalog.sql` | Independent public publication table, validator, anonymous read RPC, withdrawal guards. Only this public boundary needs a later additive extension. |

`shop_catalog_publications`: primary key `version_id` referencing `shop_quest_versions`, unique `offer_id`, strict `payload`, state `published|withdrawn`, `published_at`. RLS enabled; all table privileges revoked from public/anon/authenticated/service_role. The immutable trigger allows only state changes, rejects deletion, and validates offer/version identity. Payload size is capped at 65536 bytes. `validate_shop_public_payload` allows exactly card/compatibility/demo sections and `{status,value}` claims. Public demo allows only question/label/hint/inputMode; no answer, media, URL or trace fields.

`read_shop_catalog(p_slug text default null, p_version_id uuid default null, p_offset integer default 0)` returns a JSON array. It is stable SECURITY DEFINER with empty search_path and EXECUTE only for anon/authenticated. Offset is 0..10000, version requires slug, each page has at most 100 rows. For each product it selects the latest publication by `published_at DESC, version_id DESC`, or the exact requested version. Lists omit withdrawn rows; direct detail reads return tombstones with `payload:null, offer:null`. DTO keys: slug/product_id/version_id/version_label/state/payload/offer. It joins version identity, but does not expose quest_snapshot/task_snapshots. The migration also guards order insertion against publication withdrawal and updates `read_shop_offer`; those commerce operations need no changes for this foundation.

Exporter is a separate offline boundary: `scripts/quest-public-export.js` produces unpublished public preparation snapshots with four demo fields and `playable:false`. `scripts/quest-passport.js` has editorial answer/explanation fields, but unsupported review evidence can be a gap rather than a validation error. Therefore neither `validation.valid` nor a `confirmed` claim is sufficient authorization to export new answers/assets.

## Proposed additive backend contract (not implemented)

1. Preserve `read_shop_catalog`, its validator and `shop_catalog_publications.payload` exactly. Do not overwrite the six published migrations. Agree the next migration identifier only in the backend task based on its complete approved chain.
2. Add immutable public cover records, immutable synthetic demo revisions, and an explicit product-version extras mapping. Enforce product/version ownership using FK/constraint or a guarded trigger; bind mapping to the actual catalog publication. No source-task ID, private snapshot pointer or automatic extraction. Existing records initially have no mapping and render fallback.
3. Keep review evidence/internal source references private. A trusted publication operation verifies rights for exact bytes/text, review scope including public answer/explanation, raster magic bytes and dimensions, stripped metadata, content digest and allowed asset location. Emit only a safe public review reference, rights basis and required attribution. Server review state and revocation are authoritative; a browser boolean is not authorization. Candidate `review_id` must identify a public attestation, not expose an internal reviewer record.
4. Proposed `read_shop_catalog_v2` keeps v1 parameters/paging and returns `{schema_version:2, items:[{catalog:<unchanged-v1-row>, cover:<record|null>, demo:<record|null>}]}`. Reuse v1 selection/tombstone semantics; project approved mapped extras with exact fields only. Both extras are null for tombstones, missing mapping, failed review or revocation. A malformed publication must not cause private fallback. The future adapter validates the wrapper and embedded old row independently; old clients continue calling v1.
5. RLS on new public-schema tables, no direct client table writes/reads, narrow read-only RPC grant, explicit trusted-publisher privilege design. Do not broaden existing service-role access to private snapshots. Tests must prove anonymous/member/outsider behavior and that no joins expose captured content. New mapping is immutable after publication; revisions require an explicit new publication policy, never silently rewriting what an old pinned version means. Emergency revocation overrides historical display.
6. Same-origin raster derivatives are the initial candidate. Agree hosting, CSP (`img-src 'self'`, no wildcard), cache lifetime and revocation/purge semantics before integration. Removing an RPC record alone does not remove already public cached bytes; immutable URLs must not imply irrevocable publication. No storage bucket, worker or real asset is created here.
7. Exporter v2 accepts a separate reviewed public-record input and explicit mapping; validates approvals as hard errors and hashes the canonical output. Do not add private answer fields to the existing exporter allowlist. Keep provenance evidence out of the browser bundle. Snapshot-preview v1 remains unchanged until a deliberate separate v2 preview path is approved.

Open decisions: exact product/version-to-demo mapping; actual question/options/feedback; asset selection, rights and attribution; public review-reference semantics; limits and digest canonicalization; hosting/CSP/cache withdrawal behavior; immutable mapping update policy. Single-choice is the implemented candidate; free-text normalization requires another explicit contract.

## Current validation and limitations

User manual run: **2026-10-12 17:09:13.387 through 17:09:28.700 UTC**, preserved in `qa/review-fix/runs.json` and six individual logs. All six receipts record exit0 and verifiedCommit `220ce8bd660ef860c29500775cbd4fc911010a28`. The executor reconciled the saved log SHA256 values and input hashes against current files; it did not rerun tests. Earlier executor EPERM failures remain historical, superseded for these checks by this user-run evidence.

- Focused `npm run test -- tests/publicExtras.test.jsx`: **10/10 PASS**, including licensed-attribution negative and positive cases.
- Browser `npm run test:e2e -- --config foundation.playwright.config.mjs`: **1/1 PASS**.
- Market lint/build and root lint/build: **all exit0**. Root lint retains warnings. The production bundle marker scan remains distinct from Git baseline comparison.
- The earlier full 86/86 suite is historical pre-fix evidence, **not** a post-fix full regression run. No claim of complete regression or overall acceptance is made.
- HEAD is user-verified and supported by receipts. User evidence at 17:21 UTC (`Sentinel_765334e848bc8191982d9e9ebf4e5cc4`) reports `git status --short --untracked-files=all` with exactly 17 untracked files and empty baseline `git diff --stat`: no tracked modifications. Executor Git and E1 tracked-ref reads remain unavailable; no trust override or new Git rerun is claimed.
- No DB/RLS, remote, publication or real-asset checks. Reviewer reported P2 resolved, 13/13 hashes, 26/26 in-memory checks and SQL manifest confirmation; its independent local receipt review is separate from the user's test execution.

## Exact review-ready allowlist

Paths relative to this worktree; this is a review scope, not authorization to stage or commit. No blanket `market/qa/**` inclusion.

```text
market/src/publicExtrasContract.js
market/src/PublicCoverCandidate.jsx
market/src/PublicDemoCandidate.jsx
market/src/publicExtrasCandidate.css
market/tests/publicExtras.test.jsx
market/tests/publicExtrasFixtures.js
market/tests/foundation-browser/harness.html
market/tests/foundation-browser/harness.jsx
market/tests/foundation-browser/foundation.spec.js
market/foundation.playwright.config.mjs
market/qa/run-foundation-checks.mjs
market/qa/verify-foundation.mjs
market/FOUNDATION-REVIEW.md
market/foundation-manifest.json
```

Supporting evidence only: `market/qa/review-fix/runs.json`, `git-head.log`, `focused.log`, `browser.log`, `market-lint.log`, `market-build.log`, `root-lint.log`, `root-build.log` (all eight under that same directory), and `market/qa/foundation-browser/demo-390.png`. Of the 17 user-reported untracked files, exactly three are outside the 14-file commit-review allowlist: `market/qa/foundation-browser/.last-run.json`, `market/qa/foundation-browser/demo-390.png`, `market/qa/review-fix/runs.json`. Keep these as local evidence, not commit candidates. Also exclude generated `dist/`, `market/dist/`, TEMP/cache directories, logs and unrelated QA from the commit scope. Remaining gates: full regression if required by acceptance; backend contract/rights/content/hosting decisions and separately authorized integration. No backend activation is part of this foundation. Bounded status: foundation ready for commit review; P2 independently resolved, focused10/browser1 and all six manual-run steps PASS. This is not full-suite or integration acceptance.

## Historical validation before correction (reported, not current acceptance)

- RERUN: Market `npm run test`: 86/86 unit/UI tests (14 files), including six new foundation tests and existing filterfix coverage.
- RERUN: Market lint/build and root lint/build. Root lint retains existing warnings. No dependencies or lockfile changes.
- RERUN browser: **1/1 PASS, runner exit0**, `npm run test:e2e -- --config foundation.playwright.config.mjs`; isolated local Chrome on port4197, external requests blocked. Keyboard/radio, empty/wrong/correct/reset, revision reset, return focus, reload reset, no interaction requests or Storage/IndexedDB writes, widths320/390/768/1440. Test image deliberately returns404. Screenshot under `qa/foundation-browser/demo-390.png`, visually inspected: no clipping or overflow. This intentionally plain foundation harness is not a final approved-layout implementation.
- Initial Market tests failed before executing assertions because system TEMP mkdir was denied; initial root build similarly failed during service-worker generation. Both were rerun successfully with TEMP/TMP scoped to this worktree's `market/qa/foundation-temp`.
- Windows Playwright server teardown required stopping only the Vite PID reported by this task after test completion; test runner status is reported separately from assertion completion.
- NOT RUN: DB/RLS execution, remote HTTP/CI, actual asset delivery/CSP headers, native screen reader/Safari, backend integration or commercial acceptance. The foundation is not a deployed feature or a rights approval.

Changed files: only the new four candidate modules, test fixtures/unit/browser harness/config, this review and foundation manifest; local QA adds the verification script and browser evidence. Generated TEMP contents are ignored locally and preserved. No pre-existing tracked file changed. Backend decision must precede exporter/SQL/adapter integration; real assets require separate content/rights review. No push, PR, merge, deploy, DB/Docker action, credential read or file cleanup.
