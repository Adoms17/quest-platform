# Staging decision manifest — 2026-10-07

Status: **local proposal / HOLD pending gates below; no release authorized by this document**.
Objective: release the reviewed offline-access, profile identity and account-activity integration to staging only.
Target: `quest-platform-staging`, Supabase project **`jeugfyaqzfgdvfhdxfht`**. Production is excluded.
Candidate: **`8c9ae161d6a9d2a9c51be2940a14d945128752eb`**; baseline `2834d4561a855f2cee64dce5420fb65e55d0e331`.
Worktree: `M:/Dev/Projects/quest-platform/integration-offline-profile-activity-20261006.local`; branch `codex/integration-offline-profile-activity-20261006`.
HEAD and clean initial status were verified locally for this update. No other worktree, source code, migration or security setting was changed.

## Backup checkpoint: updated, not restore-tested

Owner-reported UI evidence: Pro purchased; Dashboard header identifies `quest-platform-staging`; [scheduled backups page](https://supabase.com/dashboard/project/jeugfyaqzfgdvfhdxfht/database/backups/scheduled) shows physical backups and a Restore action for **2026-10-07 08:12:24 UTC**. This screenshot evidence was supplied by the coordinator; this worker did not open the remote Dashboard or independently restore anything.

- Backup presence: **OWNER-CONFIRMED**. For a Dashboard restore, project `jeugfyaqzfgdvfhdxfht` + timestamp `2026-10-07 08:12:24 UTC` uniquely identifies the selected visible copy. No hidden backup ID is required for this UI route and its absence is not a release blocker. A separate ID would be needed only if a later explicitly chosen API/tool requires it; no such route is selected here.
- Actual restore / restore drill: **NOT RUN**. Restore duration and exact downtime are unknown.
- Storage object bytes: **NOT covered by this DB backup**. Database metadata is not an object-byte backup.
- Screenshot also reports `next 07:35:09`, earlier than the stated latest backup time. Preserve this reported value without inferring a date, schedule or freshness guarantee. This schedule-label ambiguity does not invalidate the specifically identified existing backup or create another backup gate.
- Manual dump: **not obtained** (zero-byte partials retained). Direct IPv6 is unreachable from ADOMS-HOME and the cached PG17 runtime. Session pooler EOF remains unexplained; its startup read-only default was observed OFF, while explicit read-only transaction checks subsequently passed. Do not resume manual backup, CLI troubleshooting or export as part of this release plan.
- No PITR or IPv4 add-on purchase is assumed or required by this proposal. Owner must accept the selected physical-backup recovery point and untested-restore risk, or keep the release on hold.

## Exact change set and order

SHA-256 below was recomputed from local files at the candidate SHA:

| Order | Migration | SHA-256 |
| --- | --- | --- |
| 1 | `20261006010000_participant_profile_identity.sql` | `E5E691D622BD62857F244F897F5D142F4CE8A7ABD197C2A9A4714184300F2612` |
| 2 | `20261006020000_record_account_activity.sql` | `DC9A0FAB0445FF740C6B909A124CB52AB676BFB2D177942B7D28C19C33AC63D0` |

The first migration adds identity fields, revision/validation RPCs, private upload/UUID registries and RLS, changes profile-card/group projections, and adds the private `participant-avatars` bucket and bucket-scoped policies. Existing Storage schema must already exist. The second adds `account_activity`, own-account SELECT RLS, and the authenticated `record_my_account_activity()` security-definer RPC with server-side daily coalescing. It does not authorize cross-account reads or direct client writes.

Storage scope: new **private** `participant-avatars`, `image/png`, 1 MiB. Additive policies include restrictive fences for this bucket; they must not be described as having no effect on permissions. Client direct insert/update/delete remains denied; verified Edge code performs scoped service-role operations. Stop on an existing bucket, policy/function collision or unexpected migration history; do not delete, replace or adopt remote objects automatically.

Edge scope: only `participant-avatar`, from `supabase/functions/participant-avatar/index.ts` and `_shared/participantAvatarEndpoint.js`, `_shared/participantAvatarPng.js` at the candidate SHA. Preserve `verify_jwt=true`, Auth validation, scope checks and pinned `npm:@supabase/supabase-js@2.112.3`. Existing platform-provided credentials stay inside the trusted runtime; no secret reads, new credentials or frontend service-role key. Candidate origin allowlist includes `https://stage.qvesta.ru`, `https://app.qvesta.ru` and the existing three local development origins; approval must acknowledge that exact current list, not assume it is staging-origin-only. No allowlist broadening is proposed.

Frontend scope: exact candidate application artifact after backend acceptance, including actor/profile/TTL offline checks and IndexedDB v15 recovery, curator terminology, identity UI and account activity hook. Do not deploy the old local `dist` as an approved staging artifact. Record the new build hash and deployment ID with the verified staging target mapping.

## Remaining gates: short execution sequence

1. **Owner/UI checkpoint:** accept the already identified project/timestamp backup and restore risk, and name a maintenance/rollback decision owner. Record current frontend deployment ID and backend function versions. No hidden backup-ID lookup or restore action is required during preflight.
2. **Cloudflare gate:** verify account/project, branch/environment triggers, `stage.qvesta.ru` routing, Supabase staging binding by non-secret project reference, and previous deployment rollback target. Existing historical `Workers Builds: quest-platform-staging` and `qvesta-admin-stage` checks do not prove current mapping. A merge may auto-publish frontend (and admin): no merge/publish until the actual trigger map permits backend-first order. Do not disable protections or change triggers implicitly.
3. **Authorized remote read-only preflight:** compare deployed migration history to candidate; inspect relevant RPC ACL/RLS definitions and bucket/policy collisions, existing Storage objects/coverage, and protected execution-ref eligibility. Save metadata only. Pending set must contain exactly the two approved migration IDs, in order; stop on drift or additional pending changes. Do not run broad `db push`, migration-history repair or remote test suites.
4. **After the scoped security approval below:** apply only these migrations to staging using the approved execution path; confirm history and security invariants. Deploy only `participant-avatar` with JWT verification. Run approved synthetic staging backend smoke, including wrong actor, revoked access, invalid JWT, private/public Storage read denial, forbidden direct writes and revision/cleanup races. No real-user destructive tests or billing operations.
5. **Backend before frontend:** only after backend smoke passes, publish the exact app candidate through the confirmed staging route; verify actual build/deployment identifiers. Check real stage-origin CORS/Edge flow, nickname/avatar lifecycle, logout/account-switch privacy, offline TTL/pending recovery, and account-activity isolation. Stop on unexpected results; do not represent local tests as hosted acceptance.

### Minimal owner approval bundle (staging only; not yet granted here)

Approve the two named migration IDs with the hashes above on `jeugfyaqzfgdvfhdxfht`, including their RLS/grants/security-definer functions and private Storage bucket/policies; deployment of the exact `participant-avatar` code with its current origin list and `verify_jwt=true`; and scoped synthetic acceptance of those security boundaries. Identify the executor and approved backend-first execution route after Cloudflare mapping is confirmed. Accept physical-backup checkpoint `2026-10-07 08:12:24 UTC` (or an explicitly selected newer confirmed copy), untested restore, downtime and post-checkpoint data-loss exposure, and the separate Storage-byte gap for this limited staging release.

This bundle does **not** authorize production, policy relaxation, credentials/role creation, billing flags, unrelated functions/buckets, disabling scheduled protections, purchases or a destructive restore. A real incident restore needs a separate explicit decision for the exact backup and affected staging writes.

### Concrete no-CLI-role apply route proposed for owner approval

The existing `.github/workflows/deploy-staging.yml` is not a scoped ready-made route for this candidate: it uses `supabase link` / linked `db push`, and has no profile-identity/account-activity operation. Do not dispatch its generic deploy as a substitute.

Use the owner's existing Supabase Dashboard session on the named staging project: SQL Editor for a read-only history/collision check, then reviewed exact migration SQL in the order above; Edge Functions Dashboard for only the three-file `participant-avatar` source tree and its existing JWT setting. No Supabase CLI, temporary CLI login role, new credentials or broken local DB connection is required. Before the first write, prepare the exact SQL transaction boundaries and successful-apply history registration against the existing `supabase_migrations.schema_migrations` layout. Only record the two genuinely applied IDs with their source names/statements as appropriate; never mark unexecuted SQL as applied or repair unrelated history. Atomic application/history tracking is part of this proposed manual route and approval, not a claim that SQL Editor automatically records migrations. If the UI cannot preserve the multi-file Edge source layout or the existing ledger cannot be safely registered, stop that operation rather than silently switching tools or bundling other changes.

After migration/Edge smoke, use the verified existing Cloudflare staging deployment route. Do not create a new deployment workflow/infrastructure just to answer this decision request.

### Cloudflare: exact remaining UI check and existing evidence

| Worker | Already recorded evidence | Still to confirm in owner UI |
| --- | --- | --- |
| `quest-platform-staging` | Successful build check at staging `2834d456…`; build `9e8dbcc5-bfa9-4038-a05b-ef35ebb18328`, version `7ac24890-1936-4b57-bd5e-edbb1c8058ba` | Connected repository; exact build branch (expected `staging`, unverified); build/deploy command and environment; `stage.qvesta.ru` route; staging Supabase binding; auto-deploy/preview triggers and prior version rollback |
| `qvesta-admin-stage` | Successful check at the same SHA; build `b10d6159-b78f-410a-83dd-88322f623420`, version `ae0b83e3-88f8-4e78-a4e2-206e4e7bccd2`; `admin/wrangler.stage.jsonc` declares this name and `stage-admin.qvesta.ru`, mode `staging` | Actual repository/branch trigger and deployed domain/version; whether publishing this app candidate also rebuilds admin; scope/avoidance of unintended admin release |

`wrangler.jsonc` locally declares base name `quest-platform` with an empty `env.staging`; it does not prove a dashboard branch/domain mapping. The base/production Worker mapping and `main` triggers are unverified and excluded from this release. Build checks demonstrate that the two staging-named Workers built that historical commit; they do not prove current live routing or protected backend-first ordering. The immediate practical UI step is to show Builds/Settings + Domains/Routes for these two named Workers, not discover every Cloudflare resource.

## Rollback boundary and data preservation

- First stop rollout and return the frontend to its recorded prior staging deployment; preserve backend additions where safe. A route/build rollback is not a DB rollback. Do not assume an older client can reverse IndexedDB v15; keep pending/review results and do not clear browser databases.
- Never use a blind down migration or delete `participant-avatars`, avatar bytes, upload/UUID anti-reuse registries, identity data, activity rows or unrelated buckets as a rollback shortcut. Do not widen RLS, make the bucket public, or disable JWT verification to make old flows work.
- If DB restore is chosen, explicitly select the physical backup at **08:12:24 UTC on 2026-10-07** (unless a newer checkpoint is separately confirmed). It restores the database to that point, not just these migrations: later account/Auth, quest, result and service-metadata changes can be lost. Exposure is the interval from that checkpoint to the restore/write-stop boundary; no precise RPO improvement is claimed without another confirmed backup.
- Plan an owner-approved staging maintenance window: block/coordinate writes and uploads before restore, account for offline clients and queued sync, and keep them paused until DB/function/frontend compatibility and idempotency checks pass. Restore causes downtime; no measured RTO is available. Reconcile scheduled jobs/configuration from the restored point before reopening, without silently changing financial or security settings.
- Storage bytes do not rewind with the DB. Post-checkpoint objects may become unreferenced, and objects deleted after the checkpoint may be missing despite restored metadata. Preserve bytes; reconcile references and UUID reservation history before uploads/cleanup resume. A new empty bucket must be confirmed at preflight; if it already contains data, stop for a specific object-preservation plan. No raw Storage SQL deletion or cleanup sweep is authorized.

## Evidence and what remains locally closable

Reported existing candidate evidence, not rerun in this docs-only update: **148 unit**, **23 offline browser**, **2 profile/activity browser**, **6 real-backend browser**, **326 local migrations**, **156 SQL/RLS assertions** plus concurrent activity checks; lint/build PASS. The first combined backend cleanup failure and subsequent successful rerun remain documented in [integration report](INTEGRATION-OFFLINE-PROFILE-ACTIVITY-20261006.md). Local containers/network were cleaned up. Preserve the historical **19 SKIP**; full avatar Edge/Kong lifecycle and hosted acceptance are not newly claimed.

Locally closable without remote access: candidate/hash/scope review (done here), manifest consistency, existing artifact comparison and review of the two migrations/security code; targeted reruns only if code changes or new findings justify them. These cannot establish remote backup restorability, Cloudflare mapping, hosted migration history, private bucket state or staging-origin behavior.

Checks rerun for this documentation update: manifest/hash consistency PASS; `git diff --check` PASS; `npm run lint` PASS with existing warnings; `npm run build` PASS, including PWA generation (slow closeBundle hook, exit 0). Generated local `dist` remains unapproved for deployment. No unit/browser/SQL acceptance suite was rerun for this prose-only change.

Requires owner/UI or scoped access: current Cloudflare route/trigger/rollback mapping, deployed history/collision checks, acceptance of security changes and recovery risk, actual stage backend/frontend smoke. The backup is already identified by project and timestamp; no further hidden-ID research is required. Restore-tested status requires a real separately approved drill; a visible Restore button does not close it.

This update changes only this manifest. No remote DB/browser/CLI call, manual dump retry, deployment, merge, infrastructure creation or security modification was performed. The candidate remains **HOLD for owner decision and outstanding gates**, not staging-ready.
