# Recovery context R: isolated database validation

2026-10-09, ADOMS-HOME. Result: PASS for the bounded isolated R-only database suite. Ready for independent review, not runtime enablement or production Go.

## Baseline and scope

Worktree: `M:\Dev\Projects\quest-platform\fiscal-recovery-context.local`. Branch: `codex/fiscal-recovery-context`. HEAD remained `b54611002f749b2b780e679bccaa1fe206bb7e9b`.

The owner explicitly authorized applying the R candidate only inside an owned disposable test database, validating it and removing the test containers. Initial status contained exactly the seven previously prepared untracked files; all seven hashes matched the 2026-10-08 handoff. None of those seven files was changed during this phase. This phase adds only the isolated harness, its verifier and this report. Existing tracked files remain unchanged; no commit/push/PR/deploy.

The earlier report and NOT RUN/UNAPPLIED source comments describe the earlier preparation snapshot. This report supersedes that validation status only for the isolated test database. No shared, hosted or working application database received the candidate. E/C, runtime wiring, provider calls and Auth API calls remain outside scope.

## Execution and results

Final DB command, from this worktree in PowerShell:

```powershell
$env:QVESTA_TEST_RECOVERY_CONTEXT='1'
npm run test -- scripts/fiscal-recovery-context-isolated.test.js
```

Final run started **2026-10-09 04:11:35 UTC** (Vitest printed host-local 07:11:35, UTC+03:00), exit 0, **3 passed, no skipped tests, 94.07 seconds**. Two tests validate the migration plan and isolation preflight; the third executes the full-chain DB suite and awaits the verifier and cleanup. Assertions throw on failure; no swallowed/skipped database branches.

The harness applies all **327 repository migrations**: 99 baseline, 225 historical, 3 later release files, then the checked-in environment-guard adoption release and disposable sandbox pin. Baseline catalog fingerprints and existing organization preservation are checked. The unchanged R candidate is then applied to that schema.

| Required case | Executed evidence / result |
| --- | --- |
| Candidate and dynamic gateway patch | SQL transaction succeeded. Function ACL unchanged. Removing the one R allowlist entry and R branch reconstructs the previous gateway definition exactly. No E/C functions installed. |
| Actual roles, ACL and RLS | Original deferred pgTAP file executed: 28 assertions passed, including actual anon/authenticated/service role calls, table/private-reader denials, RLS flag and service-only gateway access. |
| Immutable evidence | Owner UPDATE, DELETE and TRUNCATE each rejected by the existing immutable trigger; no trigger disabled for these tests. |
| Expiry after lock wait | Holder locks subscription; R passes entry authorization and blocks behind it. `pg_stat_activity` plus `pg_blocking_pids` verifies the real dependency. JWT expires before holder releases; R denies. |
| MFA after lock wait | Same real subscription-lock barrier, MFA initially within the 300-second window and stale after release; R denies. |
| Owner revocation while waiting | Owner fixture revokes the assignment while R waits for subscription; R denies after release without evidence/provider IDs in the error. |
| Scope removal while waiting | Owner fixture deletes the admitted organization scope while R waits; R denies after release. |
| Existing foreign evidence | A separate organization/order, fiscal reservation, linked refund, dispatch and normalized evidence are owner-seeded with normal FK/check/lifecycle triggers. Evidence really exists; asking the original command for that evidence produces the same 42501/message as missing evidence. Fixture rolled back. |
| Production/unpinned | Owner-only transaction temporarily disables the pin's identity-immutability trigger to perturb the pin; production and empty-pin calls deny. Each failed transaction rolls back both DDL and data. The environment guard implementation is unchanged. |
| Scoped digest | Subscription cancellation flag, ledger version and access-period changes change the digest. Unrelated organization names do not. Rollback restores original digest. Payment/fiscal review flags deny. |
| Concurrent consistency | Subscription mutation commits while R waits; resumed R digest equals a fresh post-commit read and differs from the original digest. PostgreSQL's revision trigger remains active. |
| No R domain writes | Hash snapshots of every public/private table are compared around R, negative probes and rolled-back fixture perturbations. The original 28-assertion suite separately compares 15 financial tables. Test-owner writes in concurrency scenarios are intentional fixture changes, not attributed to R. |
| Existing gateway actions | `status`, `claim` (reconcile, no second send), `before_send` execute; existing `record` shop validation rejects; existing `review` executes in a rolled-back transaction. Prior gateway definition preserved except R addition. This is not a new provider-success acceptance test. |
| Claims restoration | pgTAP checks both `request.jwt.claims` and `request.jwt.claim.sub` after successful R and caught rejection. |

The verifier additionally runs 2 assertions for existing record/review branches, 5 for claims restoration and 2 for existing foreign evidence, beyond the original 28. Fixture setup also executes its inherited assertions; these are not counted as new R acceptance coverage.

Other reruns on 2026-10-09:

- `npm run test -- supabase/functions/_shared/subscriptionFiscalRecoveryContextStorage.test.js supabase/functions/_shared/subscriptionFiscalRecoveryRead.test.js supabase/functions/_shared/subscriptionFiscalRefundStorage.test.js supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js`: **4 files / 249 tests PASS**, 1.55 s.
- `npm run lint`: exit 0; only the same 8 pre-existing UI warnings. An intermediate unused-verifier-variable warning was resolved by using that helper in the completed checks.
- `npm run build`: PASS, 349 modules, PWA 80 precache entries. Only ignored local dist output generated.

## Harness corrections and sequential attempts

Five DB attempts ran sequentially. No overlapping DB reruns or shared fixtures. Each failed attempt disposed its own containers before the next attempt began. The R SQL candidate and adapter were unchanged throughout.

1. 105.836 s: candidate applied, then harness failed because JavaScript replacement-string processing collapsed SQL `$$` to `$`. Fixed by replacement callback.
2. 64.659 s: 28 pgTAP plus ACL/immutability/action/claims checks passed; digest test failed because direct revision-only UPDATE is intentionally ignored by `bump_subscription_revision`. Changed the fixture to mutate a real subscription field.
3. 63.752 s: digest/environment cases passed; foreign fixture insertion was correctly refused by `guard_legacy_fiscal_ledger`. Rebuilt foreign fixture with separate order and valid lifecycle transitions, without bypassing refund triggers.
4. 71.283 s: expanded action/claims/digest cases passed; foreign fixture attempted duplicate fiscal terms already created by the existing receipt trigger. Removed the redundant seed.
5. 94.07 s: final complete suite PASS, including five two-backend scenarios and cleanup.

These were harness/fixture corrections, not successful runs retroactively substituted for failures.

## Isolation and cleanup

Docker server: 29.8.2. Local images only, `--pull never`:

| Image | Full image ID |
| --- | --- |
| `supabase/postgres:17.6.1.165` | `sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518` |
| `supabase/gotrue:v2.196.0` | `sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232` |
| `supabase/storage-api:v1.70.3` | `sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd` |

Each attempt creates a DB container with `network=none`, no published ports or host bind mounts. Auth **schema migration only** and Storage schema startup share that DB container's isolated network namespace; no Auth API or provider is called. Generated synthetic credentials stay internal and are not printed. The only HTTP health probe is Storage loopback inside its isolated container. Initial active cron count is asserted zero.

Preflight checks exact full ID and `qvesta.test.owner` label, network, ports, privileges, mounts, restart policy and expected environment. Cleanup rechecks ID/label and uses `docker rm -f -v` on only IDs returned by this invocation, then verifies container absence. No prune, shared stack access, named-volume deletion or lookup-by-name cleanup.

At **2026-10-09 04:13:49 UTC**, a separate read-only `docker ps -aq --no-trunc --filter id=<full-id>` check returned empty for **all 15 IDs** below. Cleanup commands succeeded; container absence independently verified. Anonymous image volumes were handled by `rm -v`; no separate volume inventory was retained.

| Attempt / owner-label suffix | Role | Full container ID, verified absent |
| --- | --- | --- |
| 1 / `ac01475eedf04e1d9c8242d66a286404` | DB | `0845839e5a7ca6e3f8279361b88364e16643facfe75b137abbc00ac76c5b6875` |
| 1 | Auth schema | `b4b3dc81f131657f614f4a255abfc9661ea2eb41f173946b9d69ed37191865b4` |
| 1 | Storage | `2e9a69da6359fc7f5b02fdf9b54c28b8f0ad8c93176d1e5dd50976ab1cc5a472` |
| 2 / `043750500d8448abab5204dd84f57dcb` | DB | `ed3500bbe4155908230376e6c7816b2a4e380def10c1a1749d5ac76c8bc7c33d` |
| 2 | Auth schema | `1267eede7f0ad4cc451e015a602fb87da21397c4297942b83c6a071ad0fe702b` |
| 2 | Storage | `3edd3ec5d1c0bec8a0247ab4337bad320073c2bcfcf54d5a0f70f738c16a0d7a` |
| 3 / `3ab4ca72b80c43ce8d160a012c98091f` | DB | `96412bcd7a88723e70fa349e77c5492ff8db66e34d2b85ce5fa7e49eca3d388f` |
| 3 | Auth schema | `1a928d3acecf0578f509d6f4be688e21546aca96fbae10cc9b5dd51590028d3f` |
| 3 | Storage | `4316d269ed05d11625fe8f8daad11f6a65c233492da5263ad9604f2f87306a9a` |
| 4 / `72dc02f82ebd4782b6a03554af8563df` | DB | `1e3fc3bd9ec44947ffd9c8cdec6eacd49f57fb167896be719fe18e52391612db` |
| 4 | Auth schema | `3c63ca554ab5095255b87a212973e414ee753852d8be9e8918b991e7875343b6` |
| 4 | Storage | `ad36cd5d01db4161b319389f5b9a7d78696cf74770b131511484da8272f1ce62` |
| 5 / `735b088dede34bf99a00bc68c6269559` | DB | `b8f52518f2355af283aa937b8b67062432e61a524ff9dccd050448052270581c` |
| 5 | Auth schema | `b530e0d9072a681f7cd166621fa724b8bf93888c732c5638f6cfbd229a217b26` |
| 5 | Storage | `0911bea609a358da7c391a9a0ca199ac727f60d53f5fbbb5022f66f1e4841192` |

Each full owner label is `qvesta-release-test-<suffix>`.

## Deliverables and remaining boundaries

New files in this phase:

- `scripts/fiscal-recovery-context-isolated.test.js`: SHA256 `244BBABC3887E2DE37337A84ED6179E9FC5196F7486A4F8DDAA959D5066A9343`.
- `scripts/verify-fiscal-recovery-context-database.js`: SHA256 `D57418920C07952B236E6D5D02556EE0C78BC378A0278E1939248728293B587B`.
- This dated report; its hash is supplied in the completion message.

Unchanged reviewed candidate SHA256: `660EB4A325273E637623A3D302CBD54E21B8B40C3904C384877F8A45F0A25974`. The other original hashes remain listed in `PROD-PAY-05-RECOVERY-CONTEXT-R-LOCAL-20261008.md`, whose unchanged hash is `79F9B9B29BBE868CEA35AE8DBED6082D70CFD215409811E26B27E1DB655E19AE`.

The executed cases establish local PostgreSQL behavior under this specific schema/role model. They do not establish hosted administration permissions, authentic provider evidence provenance, Auth/JWT HTTP acceptance, all possible writer interleavings, production configuration, or atomic commit/CAS. The concurrency mutation is a controlled owner-fixture write; it is not an exhaustive test of every application writer/recurring workflow. Foreign evidence is owner-seeded, not produced by a sender capability. R remains observation-only and the JS adapter remains unwired. E/C and publication require their own scope.

No tool auto-review rejection blocked this phase. Default-sandbox git ownership and Docker pipe restrictions were handled through approved escalated tool calls without modifying ACLs, git configuration or access routes. No secrets were read. Independent review is the next handoff; no additional DB run is needed absent a concrete finding or change.

## CI preparation, 2026-10-09

The owner subsequently authorized publishing this R-only slice as a separate draft PR targeting staging and adding isolated DB CI. Publication follows independent review of this CI diff; no commit/push has occurred at this preparation checkpoint.

The workflow adds one step to the existing `production-billing-sql` job after its three unchanged database steps. It runs `scripts/fiscal-recovery-context-isolated.test.js` with `QVESTA_TEST_RECOVERY_CONTEXT=1`, verbose reporting and a 10-minute step timeout. Following independent CI review, the DB job timeout is raised from 30 to 40 minutes: the previous test limits total 23 minutes, the new harness has a 5-minute test limit and its step allows 10 minutes, leaving 7 minutes at the combined 33-minute execution allowance for setup/cleanup. This is budget headroom, not a guarantee of completion under arbitrary runner delays. It reuses the already prepared images and Node dependencies; no new secrets, permissions, deployment triggers, runtime imports or automatic migrations are added.

Cleanup failure already enters the harness's `failures` array and throws `AggregateError`, causing Vitest/npm/the CI step to fail. There is no `continue-on-error` or shell error suppression. A forced step/job timeout, workflow cancellation or runner termination may interrupt `finally` before cleanup completes; the larger budget cannot guarantee cleanup under forced termination. Such a run is not successful cleanup proof and must not be reported as PASS.

Evidence is kept separate:

- Local DB execution: PASS as recorded above, on unchanged candidate/harness hashes.
- Independent static review: the coordinator reported static PASS except one P2 timeout-budget finding. The requested 40-minute DB job budget is now prepared for re-review; this executor has not issued an independent verdict. Static review is not a CI execution result.
- New hosted CI step: **PENDING**, not yet published or executed. No CI success is claimed.

Required CI proof on the eventual draft PR head: all three prior DB steps still pass; the new R step runs rather than skips its DB test (3 passed, 0 skipped); logs reach `R_CONTEXT_DATABASE_COMPLETE`, include all five `PASS two-backend real lock wait` modes and `OWNED_REMOVED` for every `OWNED_CREATE` ID; the step/job exit successfully. Inspect the exact head SHA/run URL and ordinary validation results before accepting CI evidence. A skipped step, missing completion marker or failed cleanup does not meet the criterion.

CI-preparation checks rerun at approximately 05:10 UTC: lint exit 0 with the same 8 UI warnings; build PASS with 80 PWA entries; focused tests **55 passed / 1 skipped** (DB deliberately not opted in); candidate-manifest integrity PASS (2 candidates, 327 historical migrations); `git diff --check` PASS for tracked changes. These do not constitute another DB run or hosted CI success. No local actionlint/YAML parser was available; workflow diff was inspected directly, without installing dependencies.
