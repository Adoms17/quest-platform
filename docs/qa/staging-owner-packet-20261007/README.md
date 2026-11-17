# Corrected staging SQL packet: exact current 326 -> 328

Latest checkpoint: [release checklist](RELEASE-CHECKLIST-20261007.md) and [owner authenticated UI receipt](edge/OWNER-AUTHENTICATED-SMOKE-20261007.json). DB/Edge, mapping and basic owner UI smoke are complete; earlier NOT RUN wording below is historical. Exact-candidate CI and the documented security acceptance scope remain open. Do not rerun completed owner steps or SQL apply.

Target only `jeugfyaqzfgdvfhdxfht` / `quest-platform-staging`. Code candidate `8c9ae161d6a9d2a9c51be2940a14d945128752eb`, governing manifest commit `3623811903bc3b7019ba97e17999a9bfda6c9d12`. Owner approved scoped staging security work on 2026-10-07 08:47 UTC. No remote SQL, CLI, credentials/roles, deployment or repair is performed by these local preparation steps.

**Previous SQL copies are HOLD / superseded. Use only the hashes below after independent review.** The earlier 324-only preflight was incorrect for deployed staging: it omitted two known release migrations stored outside `supabase/migrations`. The old diagnostic also incorrectly called the new feature IDs release IDs. That error is corrected, not a reason to repair history.

## Provenance and exact sets

Owner's current read-only result: count/distinct count 326, null count 0; all 324 baseline IDs present; extras exactly `20261003000000`, `20261003010000`; new feature IDs absent. LF-separated sorted version SHA256: `43e62d2b3279dfe6b443c5ec1dd4d29e9d2ed720bad80b019661caea173eeceb`.

The same 326-ID set is recorded in `docs/tasks/PROFILE-01-stage-metadata-20261006.json` and explained in `docs/tasks/PROFILE-01-staging-preparation-20261006.md`. `docs/process/WORKSPACE-HANDOFF.md` reports prior release work. No new CLI request was made; the prior snapshot's CLI login-role caveat is preserved. Local source verification establishes provenance, not fresh remote source equivalence.

Existing releases, **never re-executed, adopted, repaired or rewritten by this packet**:

- `supabase/release-migrations/20261003000000_adopt_billing_environment_guard.sql`: SHA256 `9F2459348E0D03BD4E6B4F66CE83D3ED5B37AC3D79E2D63B149B13286995B5B8`.
- `supabase/release-migrations/20261003010000_read_my_platform_sections.sql`: SHA256 `08C1FC5045C2172D99DF4C2CEA3E7BBBF3E51B7F0D831F4CD397DF299CEC7BFF`.

Only two new migrations execute, with unchanged source hashes:

- `20261006010000_participant_profile_identity.sql`: `E5E691D622BD62857F244F897F5D142F4CE8A7ABD197C2A9A4714184300F2612`.
- `20261006020000_record_account_activity.sql`: `DC9A0FAB0445FF740C6B909A124CB52AB676BFB2D177942B7D28C19C33AC63D0`.

Expected post-apply set is exactly those 326 existing IDs plus these two: 328 IDs, LF SHA256 `d94454b1909ae59b24fe77e34b6afd6918d90ede5ad1a2ced8db1e8f287a037b`. Guards compare the entire sorted array of IDs, not merely counts; missing, extra, duplicate and null entries fail closed.

## First owner step after review: corrected 01 only

1. Verify authenticated Dashboard URL contains `/project/jeugfyaqzfgdvfhdxfht/` and header is `quest-platform-staging`. `postgres` database name is not target proof; no portable SQL project-ref setting is assumed.
2. Execute the complete corrected **01-preflight.sql** (read-only, 30-second timeout, rollback). Return metadata/errors for review. It checks exact current 326 history, ledger layout, prerequisites and object collisions. It does not read user data or secrets.
3. Do not run 02 until this corrected preflight is reviewed. A new mismatch means STOP; no guard removal/history repair. `00-history-diagnostic.sql` is available for metadata-only troubleshooting; it now distinguishes `known_release_ids_present` from `pending_feature_ids_present`, and compares both current 326 and expected 328.

## Apply and postcheck

After successful preflight review, recheck the same Dashboard target. In 02 replace only `__OWNER_CONFIRM_PROJECT_AFTER_PREFLIGHT__` with `jeugfyaqzfgdvfhdxfht`; execute the entire file. It locks the ledger, repeats the exact current-set/collision checks, snapshots both existing release rows internally, verifies source hashes and applies only the two new migrations. Original bytes are base64 encoded for lossless copying. Only the second migration's verified outer BEGIN/COMMIT is removed for execution, so both migrations and their truthful version/name/original-source history insertions commit atomically. No existing history INSERT/UPDATE/DELETE or release-body execution is present.

Before COMMIT, assertions check exact post-apply 328 set, both new history names and single-statement-array source hashes, bucket/RLS/RPC invariants, and unchanged complete existing release rows. Errors roll back; do not run a trailing COMMIT separately or retry blindly.

Run 03 after success. It independently asserts the exact 328 version set and both new source hashes, in addition to security catalog checks. This is not hosted adversarial RLS/Edge acceptance. Do not confuse successful SQL catalog checks with complete release acceptance.

## File SHA256 (before owner confirmation replacement)

- `00-history-diagnostic.sql`: `F9E2D54940D59D7FDF092A2008FDE1D07B4CCE6E6ADF1B90C17C443F3DEDDE50`
- `01-preflight.sql`: `4806B8F4AEADE21CC12314AA0EE5190E90C4F96338AE8D51DCD6DDC2A55D1D65`
- `02-apply.sql`: `12BDA1C0A57734D932D6D888C3BC41856DC75084424D5E065DE19E2C48E57BA1`
- `03-postcheck.sql`: `1DA54FAAA80AA7798511D447F3C13878B3F429F3107016446AA50DD0E95D25AD`

## Validation and boundaries

Regenerate with `node scripts/build-staging-owner-packet.mjs` then `node scripts/build-staging-history-diagnostic.mjs`. Generator verifies unchanged new migration hashes and exact current set against both owner hash and prior local snapshot. `source-manifest.json` records all source/set hashes.

Use `RUN_ISOLATED_OFFLINE_ACCEPTANCE=1`, `RUN_OWNER_PACKET_ACCEPTANCE=1`, `RUN_HISTORY_DIAGNOSTIC_TEST=1` with `npm run test -- scripts/offline-actor-acceptance.test.js scripts/staging-history-diagnostic.test.js`. Packet mode now skips the old SQL/RLS/browser offline suites after the packet checks. It creates only disposable owner-checked local fixtures; known release ledger rows are seeded from local sources without executing those release bodies. They are compared in full before/after rollback, successful apply and retry. Synthetic drift/duplicate/collision/tampering never touches remote history.

Corrected packet validation completed 2026-10-07 09:28:43 UTC: **2 test files PASS**. Covered exact 326 history, missing known release, unknown extra, same-count substitution, duplicate, object collision, missing target confirmation, injected atomic rollback, apply to 328, retry rejection, unchanged full release rows, postcheck version substitution and tampering with each new source hash. Diagnostic checks cover 324/326/328 and drift with unchanged ledger/read-only transactions. Null rejection is independently reviewed statically, not a separate runtime fixture. Independent review **PASS**, no blocking findings. `git diff --check` PASS; lint PASS with existing warnings. Local cleanup receipts show no errors and all owned containers/network removed. Old offline/browser suites were not rerun. The earlier 324-only tests failed to model actual deployed release history; their PASS did not validate this corrected packet.

Remote apply, Edge deploy and hosted acceptance remain NOT RUN. No callable Supabase/browser route exists here; owner uses existing Dashboard session. Physical DB backup checkpoint remains 2026-10-07 08:12:24 UTC, restore untested and Storage bytes excluded. Frontend stays blocked until backend acceptance and Cloudflare mapping. Edge reference copies are not instructions to deploy as part of SQL preflight. No production, credentials, schedulers, purchases, cleanup sweep or restore is authorized by this packet.

Final npm run build: PASS, including PWA generation, exit 0. No deploy artifact is approved by this local build.

## RPC-only owner result: compact follow-up

Owner returned two RPC metadata rows from corrected 01. Both definition SHA256, signatures, security-definer flags, proconfig and ACL match local baseline evidence exactly:

- get_participant_profile_card: `403b20df44581ddfacec5e458a5af86b4f27703e5bc567044e931affa6c37251`.
- search_participant_group_members: `39196ff584afadb709ccad82a7b4a4219029538d9a200a1450f1ed4a283b5fcd`.

Evidence: `.review.local/staging-preflight-rpc-evidence.json` and `.review.local/staging-preflight-summary-evidence.json`. Local baseline function definitions were replayed; the two known release sources do not name these RPCs. This is not a new remote schema replay.

Control flow: original 01 executes its 11 guards in a DO block before the RPC SELECT, followed by a separate Storage policy SELECT and ROLLBACK. If the whole exact file ran successfully in the same transaction, all earlier guards passed. RPC rows alone do not establish that: the owner may have selected only that statement, and the RPC SELECT is not the final SELECT in the file.

Smallest missing information: confirmation that the complete corrected 01 (no selected fragment) ran in the verified staging project without errors. If uncertain, run the complete `01-summary.sql` once and return its one JSON result. No repeated result-tab collection is necessary. This optional replacement preflight evaluates all 11 original predicates inside the JSON-producing SELECT, verifies both expected RPC hashes and effective ACLs, and requires read-only transaction state. Missing/incompatible catalogs may return an error, which remains STOP. It is not permission to apply automatically.

`01-summary.sql` SHA256: `8915214E624AF17BDF3C4414F0C843C80FAC3E4E5976F371E5F0264E16DBF91C`. Generator: `scripts/build-staging-preflight-summary.mjs`; generation fails if any original guard is not parsed. Existing 00/01/02/03 are unchanged.

Validation completed 2026-10-07 09:42:15 UTC: local summary PASS on 326; altered RPC config rejected; missing known release rejected; read-write execution rejected. Independent review PASS, lint/build PASS. Owned local resources cleaned with no errors. Remote summary/apply NOT RUN by this agent.

## Latest owner-run DB checkpoint / Edge next

On 2026-10-07 owner reported 02 success at 09:52 UTC, 03 nine-RPC metadata at 09:53, and explicitly confirmed whole 03 without errors at 09:53:52 (Sentinel_3b2e1cdf05e481919fae2c9e0d2ce958). DB catalog phase is therefore **OWNER-RUN PASS** for the assertions described above; earlier NOT RUN statements describe this agent's execution, not the subsequently completed owner action. All nine reported RPC ACL/security-definer/search_path values match expectations. Do not rerun 02. Hosted adversarial acceptance remains NOT RUN and frontend remains HOLD.

Next bounded owner step: [participant-avatar Dashboard handoff](edge/OWNER-HANDOFF.md), exact three-file source tree, verify_jwt=true and unchanged origin list. No callable browser/Supabase route exists here; deployment is not performed by this agent. If Dashboard cannot preserve the sibling shared-file imports, stop rather than rewriting the reviewed candidate.

Latest Edge checkpoint: participant-avatar deployed via checked Functions API CLI route at 2026-10-07 10:08:04.120 UTC, version 1, ACTIVE, verify_jwt=true. Three downloaded source hashes match candidate byte-for-byte. See [deployment receipt](edge/DEPLOYMENT-20261007.json). This supersedes earlier Edge NOT RUN and mandatory Dashboard handoff language. Hosted security smoke NOT RUN; frontend HOLD.
