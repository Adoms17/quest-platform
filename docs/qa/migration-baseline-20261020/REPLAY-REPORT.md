# Isolated migration baseline replay evidence

Date: 2026-10-20. Status: **two successful results; one intervening failed attempt retained**. This report reads existing receipts; it does not execute a replay.

## Pinned scope

- SQL source baseline: `6075dc9755357fedd2e26c21f0655f16ceeb6a51`.
- Original inventory checkout: `ba006996d805d763e3a16a37b5bbacc49e7cffc4`.
- Unchanged [manifest.json](manifest.json) SHA256: `fef5b68e29e848f9e34e5c46d93391e8f335a51761be65e0954f8d3cb6e0627b`.
- 335 sources: 327 standard, two release payloads, six SHOP fixtures. Their locations and original SQL bytes were unchanged.
- Local disposable profile: `historical-source-legacy-grants-v1`, with pinned PostgreSQL, Auth and Storage prerequisites. It models historical grants inside the disposable database only. It is not a generic fresh-install or hardened production profile.

## Recorded chronology

| Attempt | Recorded outcome | Evidence boundary |
|---|---|---|
| Original run-1 | PASS, 335 applied; complete catalog | Included in original final receipt recorded 12:42:50.774727 UTC |
| Original run-2 | FAIL after 110 recorded completions; no complete catalog | PermissionError at recorded stage docker:exec; no SQLSTATE recorded. Original aggregate remained INCOMPLETE_REPRODUCIBILITY |
| Separately authorized replacement | PASS, 335 applied; complete catalog | One replacement run, exit 0; final receipt recorded 13:19:43.588346 UTC |

The failed run is not relabeled PASS or counted as a third successful replay. The original receipt infers a local evidence-writer failure; it did not retain the precise filesystem operation or Windows error number. Reader sharing, antivirus, ACL causes and a SQL defect were not established. An earlier engine-unavailable preflight created no resources and started no replay; it is not another SQL attempt.

The replacement used a revised evidence writer: phase/errno/WinError diagnostics, preservation of the primary error, and bounded replace-only retries of the same evidence bytes (six attempts, 1.55 seconds total). It did not retry SQL, delete destinations or change ACLs. Therefore this is not a claim of identical writer versions. Saved preflight verifies matching profile, runtime, images and applied source set, and unchanged historical package/evidence checksums. Runtime/runner changes are not included in this PR.

## Comparison and cleanup

Both successful catalogs have SHA256:
`b17b0b577583c37190736cca27873bb7e7837da6fe728f491b14fdcca3a3c962`.

The saved comparison reports equal catalog definitions and no differing categories. Both successful readbacks record cron disabled, zero cron runs, zero environment identity rows and zero HTTP queue/response observations. These counters supplement the isolated execution profile; they are not a general traffic audit.

The original receipt records runner cleanup plus independent absence verification for both original owners and all five recorded resource IDs. Replacement cleanup was recorded at 13:19:03.368389 UTC: all three recorded containers absent and no remaining owner containers, networks or volumes. The original failure evidence and checksum indexes remain retained.

## Provenance and limits

[replay-evidence-index.json](replay-evidence-index.json) identifies retained receipts by relative artifact name and SHA256. They are external local evidence, not repository-relative download links. Raw receipts are not uploaded: they contain local machine paths and unnecessary resource identifiers. This sanitized report and index publish only the necessary outcomes, source pins and checksums. A checksum identifies retained bytes; it does not make inaccessible receipts independently reproducible from this PR alone.

Accepted: the pinned isolated schema profile completed twice with matching catalog definitions. Not established: hosted staging or production schema parity, real backup restore, business-data restoration, functional/security/payment acceptance, B17, fiscal/legal readiness or production GO. No hosted SQL, endpoint calls, tests, workflow dispatch or deployment was performed for this documentation update. Ordinary automatic PR CI is separate evidence on the new head.
