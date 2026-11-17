# Hosted smoke and Cloudflare read-only checkpoint — 2026-10-07

Target: staging jeugfyaqzfgdvfhdxfht, participant-avatar v1. DB catalog assertions are owner-run PASS; Edge ACTIVE/JWT/source equivalence PASS is documented separately. This checkpoint does not claim complete backend acceptance.

## Hosted no-data probes: 10:13:10–10:13:12 UTC

| Probe | Observed | Interpretation |
| --- | --- | --- |
| POST without Authorization | 401 UNAUTHORIZED_NO_AUTH_HEADER | PASS: gateway rejects unauthenticated request |
| POST with fixed intentionally invalid JWT | 401 UNAUTHORIZED_INVALID_JWT_FORMAT | PASS: gateway rejects invalid JWT |
| OPTIONS, Origin https://stage.qvesta.ru | 204, exact allow-origin, POST/OPTIONS and required headers | PASS: deployed handler CORS |
| OPTIONS, Origin https://qvesta-probe.invalid | 403 origin_denied, no allow-origin | PASS: disallowed origin rejected |
| OPTIONS without Origin | 204, no allow-origin | Observed expected handler behavior |
| GET/PATCH without Authorization | 401 | Gateway denied; handler method 405 NOT TESTED |
| POST disallowed Origin without Authorization | 401 | Gateway denied before handler; not proof of authenticated origin enforcement |

Gateway-generated 401 responses have Access-Control-Allow-Origin `*`; they contain only generic errors. This does not mean the handler's origin allowlist was broadened. No valid credentials, uploads, profiles, account-activity calls or user data were used. Full response evidence: [UNAUTHENTICATED-SMOKE-20261007.json](UNAUTHENTICATED-SMOKE-20261007.json).

## Authenticated tests: pending authorized synthetic sessions

The managed Supabase CLI credential authorizes Management API operations, not an application user session. No permitted already-authenticated synthetic A/B session was available in this execution context. Saved browser JWT/cookies/service keys were not read; no admin impersonation, credential export, signup, password reset or synthetic credentials were created.

NOT RUN hosted: own-profile avatar upload/replace/read/remove, stranger/revoked-profile denial, malformed/oversized PNG rejection after authentication, direct Storage write/public-read denial on actual owned objects, concurrent revision/cleanup, account_activity own SELECT/RPC and cross-account/direct-write denial. Unauthenticated 401s do not establish these properties. Existing local tests remain separate evidence.

Smallest next auth step: owner identifies two existing synthetic QA accounts and signs into an isolated test browser personally, without sending passwords/JWT/cookies to the agent. A question requesting that availability is pending. If no such accounts exist, separately authorize creation of precisely two staging-only synthetic accounts with a bounded lifetime and cleanup decision; do not silently create persistent passwords/accounts. Restrict any new fixture names to a fresh run prefix such as `qa-avatar-20261007-<run>`, and record exact owned IDs for later cleanup. Do not delete accounts/profiles or sweep Storage without the required explicit deletion authorization. Ordinary avatar removal must target only that run's owned uploaded IDs.

## Cloudflare API-first results

No installed/cached Wrangler or callable Cloudflare connector was initially available. A pinned temporary `npm exec --package=wrangler@4.148.0` (no repository dependency/lockfile change) found an existing OAuth session via `whoami --json`; no login or credential extraction occurred. Only non-personal account/deployment/version metadata is retained. API account: 066c29c6d781068dc847c35a9d858a2a.

| Worker | Current deployment | Current version (100%) | Previous version |
| --- | --- | --- | --- |
| quest-platform-staging | 97f8c2ee-f48e-43b4-9336-5cbc214532de | 7ac24890-1936-4b57-bd5e-edbb1c8058ba | 050594a3-b56f-4e66-8ece-4df40577a8ef |
| qvesta-admin-stage | 268a6f6f-73d0-469d-9737-3e3ade289b03 | ae0b83e3-88f8-4e78-a4e2-206e4e7bccd2 | 0c445130-2ce0-4057-b645-43d238b069c6 |

Current deployments are from 2026-10-05; exact timestamps and version metadata are in [CLOUDFLARE-READONLY-20261007.json](CLOUDFLARE-READONLY-20261007.json). Their current versions are the baseline rollback targets for a future new deployment; older versions are history, not automatically the chosen rollback. No rollback was executed/tested. Both are static-asset Workers with no runtime bindings. Admin CSP explicitly permits the staging Supabase project.

Public unauthenticated reads of stage.qvesta.ru and stage-admin.qvesta.ru returned 200. Entry JavaScript assets contain only the observed Supabase project ref jeugfyaqzfgdvfhdxfht; no keys/tokens were extracted or retained. See [PUBLIC-STAGING-BINDING-20261007.json](PUBLIC-STAGING-BINDING-20261007.json). This verifies the deployed artifact project reference, not the next build's environment or exact Cloudflare route-to-Worker relation.

Remaining mapping: connected repository/branch, build/deploy command, autodeploy/preview trigger behavior, custom-domain-to-Worker mapping, and future-build staging binding. Inspected Wrangler commands expose deployments/version metadata but no generic authenticated Builds/custom-domain GET. Its `init --from-dash` export is explicitly unsupported for Workers with Assets, so that command was not run. No internal token extraction/unsupported auth bridge was used to force API calls. Existing managed OAuth works; a supported metadata route or owner-provided non-secret Builds/Settings + Domains/Routes fields is needed for these remaining fields. Do not change triggers or publish to infer the mapping.

References: [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [version-pinned dashboard-export implementation](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.148.0/packages/wrangler/src/init.ts).

## State and cleanup

Frontend HOLD: authenticated backend acceptance and complete Cloudflare mapping are open. No Cloudflare resource was changed; no frontend was deployed. No synthetic resources were created or deleted, so hosted fixture cleanup is not needed. Temporary Wrangler package/cache and sanitized local receipts remain for reuse/review; project dependencies and package-lock are unchanged. No browser/helper server/container was started. Source code and security settings remain unchanged.
