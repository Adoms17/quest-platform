# Migration source inventory after PR181

Date: 2026-10-20. Status: Draft PR182; source inventory verified and two successful isolated schema replay results recorded, with one intervening writer failure preserved.

## Purpose and evidence boundary

This package describes the complete **335-version source inventory** corresponding to the staging migration ledger observed on 2026-10-20 at approximately 08:33 UTC. This documentation does not execute SQL, provision an environment, or repair the ledger. Separately authorized local replay evidence is summarized in [REPLAY-REPORT.md](REPLAY-REPORT.md) and indexed in [replay-evidence-index.json](replay-evidence-index.json).

The immutable source baseline is [6075dc9755357fedd2e26c21f0655f16ceeb6a51](https://github.com/Adoms17/quest-platform/commit/6075dc9755357fedd2e26c21f0655f16ceeb6a51), the squash merge of PR181. [manifest.json](manifest.json) records every version, name, repository path, source commit, Git blob OID, SHA256, byte length, line-ending counts, and ascending inventory position. Hashes refer to raw Git blob bytes, not normalized working-copy text.

## Standard discovery versus full source inventory

| Group | Count | Existing source directory | Role |
|---|---:|---|---|
| Standard | 327 | `supabase/migrations` | Standard migration discovery |
| Release | 2 | `supabase/release-migrations` | Separately reviewed release payloads, deliberately outside standard discovery |
| SHOP fixtures | 6 | `scripts/fixtures/shop-stage-six` | Pinned disposable test fixtures added by PR181; not deployment migrations |
| Total | 335 | All three directories | Source inventory only |

All 327 standard version/name pairs are present in the [fresh staging ledger](https://supabase.com/dashboard/project/jeugfyaqzfgdvfhdxfht/database/migrations). Its eight additional entries are:

| Version | Name | Group |
|---|---|---|
| 20261003000000 | adopt_billing_environment_guard | Release |
| 20261003010000 | read_my_platform_sections | Release |
| 20261010010000 | shop_acquisitions_and_lineage | SHOP fixtures |
| 20261010020000 | shop_orders_and_fulfillment | SHOP fixtures |
| 20261010030000 | shop_order_screen_reads | SHOP fixtures |
| 20261010040000 | shop_payment_attempts | SHOP fixtures |
| 20261010050000 | shop_payment_reconciliation | SHOP fixtures |
| 20261010060000 | shop_public_catalog | SHOP fixtures |

These eight versions are absent from the **standard directory**, not from Git or the observed server ledger. There are zero standard-directory-only versions. Ledger presence does not prove current schema equivalence or the raw bytes of stored statements.

Both release payloads and all six SHOP payloads are byte-identical to the corresponding files in the published [schema package at 9da42e406406abd2538dabda1cb9c38b5a7c240d](https://github.com/Adoms17/quest-platform/tree/9da42e406406abd2538dabda1cb9c38b5a7c240d/docs/qa/shop-schema-runner/package/payload). Each nonstandard entry records that immutable provenance. No SQL is copied, moved, edited, or embedded in this package.

## Order and environment boundaries

`order` is the ascending version order of the complete inventory. The two release entries occur after `20261001000000` and before `20261006010000`; the six SHOP entries follow `20261007030000`. The inventory is not a command sequence. The separately tested prerequisite profile and its evidence boundaries are described in the replay report.

Guard adoption and environment provisioning are separate concerns:

- `20261003000000_adopt_billing_environment_guard.sql` deliberately sits outside automatic migration discovery. It checks or adopts an existing guarded environment; fresh installation leaves environment identity unprovisioned. It must not be mechanically moved into the standard directory.
- Explicit sandbox identity provisioning belongs only in a separately authorized, owned, isolated fresh-database procedure. This inventory does not supply a provisioning script, enable flags, or grant permission to run existing bootstrap helpers.
- Existing release wrappers have their own expected-history and target checks. They must not be blindly reused against this 335-version inventory or a live database.
- Six existing SHOP ledger entries are already installed on staging. Their presence here is not a reason to reapply them or relabel/delete history.

Two successful isolated runs now establish matching catalog definitions for the pinned local profile, with one failed attempt preserved between them. This does not validate other prerequisite profiles. Future executions remain separately scoped and authorized; this publication contains no runner or execution instructions.

Production is outside this evidence boundary. Its ledger and schema were not inspected, and neither parity nor deployment readiness is asserted. B17 remains on hold.

## Reported historical evidence

- [Guard adoption report](../../tasks/PROD-PAY-05-guard-adoption.md): 2026-10-03, preview after 08:28:10 UTC, followed by apply and an independent `exact_record=true` readback. This is historical evidence, not a fresh stored-statement comparison.
- [SHOP apply194](https://github.com/Adoms17/quest-platform/actions/runs/38171603970): 2026-10-11, six migrations applied. The existing local stage-apply report records an independent 335-version readback.
- [PR181 acceptance report](../shop-play-staging-fixture/REPORT.txt): 2026-10-19, isolated staging-source-plus-six-fixtures acceptance. It excluded the two release migrations and did not establish full stage parity.
- The fresh 2026-10-20 dashboard observation compared version/name sets only. Dashboard dates resembling version timestamps are not treated here as proven execution times.

## Source validation and publication status

The permitted validation is offline source inspection: parse the manifest, compare its exact path/version/name sets against immutable Git trees, require uniqueness and ascending contiguous order, recompute raw blob hashes/lengths/line-ending counts, compare eight provenance blobs, and confirm index/commit round trips do not alter bytes. It does not run database tests or contact an application.

Performed on 2026-10-20 in the dedicated `migration-baseline-package` checkout on ADOMS-HOME:

- PASS: exact 335-path/version/name inventory, unique versions, contiguous order, group counts 327/2/6.
- PASS: raw SHA256, byte length, Git blob OID, CRLF/LF/bare-CR counts for all 335 source blobs; all 335 staged SQL blobs remain identical to the pinned baseline.
- PASS: all eight nonstandard payloads match the published package bytes and blob OIDs.
- PASS: five in-memory negative cases rejected (missing entry, extra duplicate, reordered entries, changed hash, changed line-ending count). Only Python standard-library data checks and read-only Git plumbing were used.
- PASS: staged package files retain their exact working-copy bytes; `git diff --cached --check` reports no errors.
- Preparation-time NOT RUN: npm lint/build and replay. The later separately authorized local replay results supersede only the replay status; see the replay report. No local tests, SQL, live calls, provisioning or deploy were run to prepare this documentation update.

Existing [CI workflow](../../../.github/workflows/ci.yml) runs `production-billing-sql` for every pull request targeting `staging`, without a path or draft filter. It enables `QVESTA_TEST_PRODUCTION_BASELINE`, executes the historical SQL harness and isolated recovery-context database validation. A documentation-only draft PR would still trigger those jobs.

The preparation-time publication hold was resolved by explicit owner authorization of ordinary automatic isolated CI on 2026-10-20 before Draft PR182 was created. The owner also authorized this documentation update and push to the same draft branch, including its ordinary automatic isolated CI. No workflow changes, bypass or manual dispatch are included. Hosted SQL, deployment, merge, removal of draft status, payments and B17 remain excluded. CI results belong to their exact commit and do not replace the separately recorded local replay evidence.
