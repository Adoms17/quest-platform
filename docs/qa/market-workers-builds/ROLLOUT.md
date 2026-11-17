# Market stage: one Workers Builds route, local proposal

2026-10-11 UTC. This document supersedes the GitHub deployment proposal in market-stage-preparation/ROLLOUT.md and the related next-step wording in shop-schema-stage-apply/MVP-NEXT.md. Those files and all 17 apply194 evidence files are deliberately unchanged. No authorization to publish is implied.

## Exact source and target

- Repository: Adoms17/quest-platform. Base: 72e2cb1422684523ed14aaa69548a52e682f8bb4, confirmed by read-only ls-remote for staging. Proposed dedicated branch: market-stage-release (not created locally or remotely).
- Apply ONLY the overlay paths/hashes in release-package.json to that base. Never publish the inherited dirty worktree wholesale. The manifest also pins inherited build dependencies. The unchanged shared src/services/shopMoney.js and its test are required by Market and included; no App UI, SQL, Edge, Admin or Website change belongs to the overlay.
- Worker: qvesta-market-stage; account: 066c29c6d781068dc847c35a9d858a2a. Cloudflare calls its principal branch environment Production; here it is the separate STAGE Worker, never the production Quest Worker.
- Custom domain: stage-market.qvesta.ru only; existing market/wrangler.stage.jsonc. workers_dev=false, preview_urls=false, SPA assets market/dist.
- Production branch setting: market-stage-release. Preview builds: disabled. Root directory: /. Node version: 22. Build cache initially disabled for reproducibility.
- Include watch paths: market/*, src/services/shopMoney.js, scripts/market-stage-release.mjs, scripts/check-shop-release-v2.mjs, scripts/check-shop-stage-release.mjs, scripts/check-admin-stage-migrations.mjs, scripts/quest-public-export.js, scripts/quest-passport.js, package.json, package-lock.json. Exclude: market/qa/*, market/tests/*, market/dist/*, market/node_modules/*. Branch + exact SHA guard are the publication boundary, not path filters.

Existing App/Admin/Website principal branch is staging. All three have preview builds disabled (Admin rerun this phase; App/Website observed in preceding preflight). Recheck these settings immediately before first push. Do not merge this release branch into staging/main. No App/Admin/Website setting changes are needed for this route. Base GitHub workflow triggers were inspected: CI pushes only main; Admin/Website pushes only main or staging; deployment workflows are dispatch-only. None auto-runs for a plain push to market-stage-release. No PR or workflow dispatch is part of this proposal. Reconfirm if the base changes.

## One route and commands

.github/workflows/market-stage.yml is now a skipped, credential-free retirement notice. It cannot build or deploy. There is no market-stage GitHub environment or new Actions secret requirement. Workers Builds is the only proposed publisher. Existing artifact inspection and stage contract are reused.

Build command, from root (only existing package scripts):

```sh
node scripts/market-stage-release.mjs source && npm ci && npm run lint --prefix market && npm run build --prefix market -- --config vite.stage.config.mjs --mode staging && node scripts/market-stage-release.mjs check
```

For the first real-key build, the Deploy command is ONLY:

```sh
node scripts/market-stage-release.mjs check
```

This is a build-only receipt pass: no Wrangler, version upload, domain or asset publication. Record the Cloudflare Build UUID, full commit SHA and receipt digest. Build success here is not deployment success. Review these exact identifiers before the second phase.

After separate approval of that commit/digest/domain, the sole Deploy command becomes:

```sh
node scripts/market-stage-release.mjs authorize && cd market && npx --yes wrangler@4.134.0 deploy --config wrangler.stage.jsonc
```

The guard requires Workers Builds, market-stage-release, valid Build UUID, approved exact commit, account, enabled flag, confirmation, real public-key attestation and matching artifact digest. Existing Wrangler custom build also checks a rebuilt digest if invoked. Workers Builds itself does not honor custom-build config; hence the explicit build/check commands above. Never configure a bare default wrangler deploy or a preview upload command. These environment guards assume trusted build configuration; they are not a security boundary against an account administrator.

## Existing connection and credential reference

Read-only UI evidence: Cloudflare GitHub connection Adoms17 lists quest-platform. No install, OAuth authorization, repository-access expansion or credential entry was required. New Worker setup offers the existing quest-platform build token reference (build-token reference UUID 285dd798-4b07-4b7c-ae28-19822f46f70b). No token value was displayed, copied or used.

Token summary: active, no displayed expiry; target account includes Workers Scripts:Edit and Account Settings:Read; all zones include Workers Routes:Edit and SSL and Certificates:Edit; User Details/Memberships:Read. Other pre-existing permissions remain untouched. This metadata supports reuse for the intended Worker/domain operation, but no API capability probe or deploy was run.

The setup UI warns that artifacts_read and artifacts_write are absent. This proposal uses GitHub, not Cloudflare Artifacts storage. Official Artifacts integration documentation identifies these permissions for the separate Artifacts repository route. Do not add them speculatively. If Cloudflare blocks this GitHub setup or upload on a missing scope, stop and capture the exact denied operation/permission; obtain a separate narrowly scoped decision before changing access. Do not choose Create new token, rotate a token, or substitute another credential.

## Public stage key and variables

After specific configuration approval, the owner supplies the existing PUBLIC legacy anon JWT for Supabase project jeugfyaqzfgdvfhdxfht directly from that project's API-key settings into the new Worker's BUILD variable VITE_SUPABASE_ANON_KEY. This is a public browser client credential, ultimately embedded in static JS; it is not service_role, sb_secret_, SUPABASE_ACCESS_TOKEN or the database password. No key is to be pasted into chat, source, logs, .env files or evidence. No new key is required. Do not copy an unrelated existing App variable merely because its name matches.

The present stage contract supports legacy anon JWT only. A modern sb_publishable_ key is not interchangeable with this contract; adopting it requires a separately reviewed project-binding change. An authorized operator must attest exact project provenance; header/role/ref/format checks do not verify a JWT signature. A read-only public catalog request with this key can verify acceptance without service credentials. It is not run in this local phase. Synthetic build keys must never receive the public-key-approved attestation.

Build variables (no runtime secret bindings): VITE_APP_ORIGIN=https://stage.qvesta.ru; VITE_SUPABASE_URL=https://jeugfyaqzfgdvfhdxfht.supabase.co; VITE_MARKET_SALES_ENABLED=false; VITE_SUPABASE_ANON_KEY=owner-supplied public stage key; NODE_VERSION=22; CLOUDFLARE_ACCOUNT_ID=066c29c6d781068dc847c35a9d858a2a. Never override WORKERS_CI, WORKERS_CI_BRANCH, WORKERS_CI_COMMIT_SHA or WORKERS_CI_BUILD_UUID.

Set MARKET_STAGE_APPROVED_SHA to the reviewed new commit before the build-only pass; the source guard rejects default-branch/bootstrap/stale revisions before installing or building. Keep MARKET_STAGE_DEPLOY_ENABLED=false and MARKET_STAGE_PUBLIC_KEY_APPROVED unset until approval. For the approved publish only, set MARKET_STAGE_DEPLOY_ENABLED=true, MARKET_STAGE_PUBLIC_KEY_APPROVED=true, MARKET_STAGE_APPROVED_SHA=<reviewed full commit>, MARKET_STAGE_EXPECTED_DIGEST=<reviewed real-key build digest>, MARKET_STAGE_CONFIRM=publish-market-stage-off. No values exist for those future commit/build/artifact identifiers yet.

## Smallest approval sequence

1. Approve publication of only release-package.json's overlay on new branch market-stage-release from the exact base; no merge. Before push reconfirm the pinned base/workflow triggers and preview isolation. Obtain the resulting commit SHA; do not invent it from the dirty HEAD.
2. Approve creating/configuring ONLY qvesta-market-stage with the existing GitHub connection/token reference and public build variables, sales OFF; no credential creation or privilege expansion. Initial setup UI has no branch selector and defaults to preview builds enabled. Before submitting, disable previews and replace BOTH Build and Deploy commands with `node -e "process.exit(1)"`; this intentionally fails any bootstrap build without running App build/deploy commands. If the UI cannot save a non-publishing bootstrap, stop rather than use the default Deploy command. Then set the dedicated branch, paths, variables and build-only commands above before starting exactly one build of market-stage-release at the approved full commit. Verify the UI branch/SHA before starting; do not simply Retry the old bootstrap build (it may retain the original default-branch commit). Retry is allowed only when the UI explicitly identifies the approved branch and SHA. No custom domain is bound in this phase.
3. Review the actual real-key build receipt. Approve exactly one Market deploy plus stage-market.qvesta.ru custom-domain/DNS/TLS binding, guarded by that SHA/digest. Existing zone records are not replaced. Missing token scope is a separate approval, only if a concrete denial establishes the need.
4. Record Worker version/deployment ID, Build UUID, receipt digest, domain TLS and browser results. Check server catalog, DTO safety, withdrawal/version pin, SPA/reload/deep links/Back-Forward, sales-OFF/no payment submit. No fabricated catalog data. If no public listings exist, report empty catalog rather than seed the shared stage DB.

No existing Market rollback version exists. After the first deployment, retain its exact version as the future rollback candidate. Payments OFF; schema apply194 is complete and must not be repeated; B17 HOLD. Edge/App/payment/reconciliation/provider E2E and production are outside this packet.

## References

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ (existing token selection, explicit build command, WORKERS_CI variables).
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/ (separate Artifacts repository permission requirements).
- Screenshots in this directory: token-reference-summary.jpg, github-connection.jpg, existing-token-selection.jpg.
