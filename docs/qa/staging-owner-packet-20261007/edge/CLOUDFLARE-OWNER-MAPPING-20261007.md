# Cloudflare mapping: owner UI evidence, 2026-10-07

Source: owner-provided read-only Cloudflare UI observations relayed in this task. This supplements CLOUDFLARE-READONLY-20261007.json; these fields were not independently fetched through the API. No settings were changed. This establishes the two staging Workers' reported configuration, not the state of production Workers.

| Field | quest-platform-staging | qvesta-admin-stage |
| --- | --- | --- |
| Repository | Adoms17/quest-platform | Adoms17/quest-platform |
| Cloudflare production branch | staging | staging |
| Root directory | / | / |
| Build command | `VITE_SANDBOX_RECEIPTS=true VITE_CHECKOUT_DOCUMENTS=true npm run build -- --mode staging` | `npm run build -- --config admin/vite.config.mjs --mode staging` |
| Deploy command | `npx wrangler deploy --env staging` | `npx wrangler@4.134.0 deploy --config admin/wrangler.stage.jsonc` |
| Preview builds | OFF | OFF |
| Configured preview command | `npx wrangler preview` | `npx wrangler preview` |
| Custom domain | stage.qvesta.ru | stage-admin.qvesta.ru |
| workers.dev / preview URLs | ON | OFF |
| Routes | None | None |
| Build watch includes | `*` | `admin/*`, `package.json`, `package-lock.json` |
| Build watch excludes | `website/*`, `.github/workflows/website-ci.yml` | None |

Git builds are configured for staging. The owner did not see a separate production automatic-build toggle; do not infer its value. The Cloudflare label "production branch" above means the live branch of each staging Worker, not authorization to deploy the production application.

The deployed public assets' staging project reference is recorded in PUBLIC-STAGING-BINDING-20261007.json. These owner observations do not independently attest the values of future build-time Supabase variables. The local candidate preview separately verifies its built assets target only jeugfyaqzfgdvfhdxfht.

## Local candidate handoff

Candidate app source: 8c9ae161d6a9d2a9c51be2940a14d945128752eb, in the integration worktree. The loopback preview uses a public staging client configuration with dotenv loading disabled. It does not enable VITE_SANDBOX_RECEIPTS; it is for the requested login/avatar checks, not payment acceptance or final release-build parity.

- URL: http://127.0.0.1:4173/login
- Process at launch: 17092, repository owner on ADOMS-HOME; binds only 127.0.0.1.
- Automatic expiry: 2026-10-07 14:35:19 UTC. Manual stop: `Stop-Process -Id 17092` after confirming the PID still belongs to this preview.
- Build and lint passed (lint warnings retained); login and participants SPA routes returned HTTP 200.
- At 10:37:09 UTC, unauthenticated participant-avatar OPTIONS with Origin http://127.0.0.1:4173 returned 204, the exact allowed origin, POST/OPTIONS, required request headers, and no-store. No allowlist change was needed.
- Local receipts: `.review.local/owner-preview/verification.json` and `cors-preflight.json`.
- No browser was opened, no owner session was accessed, and no authenticated smoke was run.

Use existing test1/test2 accounts through owner-entered login in separate clean browser profiles; no signup or credential handoff. The original isolated acceptance harness creates accounts and must not be run against these staging accounts.

## Release status

Cloudflare mapping is recorded as owner UI evidence. Frontend remains on HOLD for authenticated backend acceptance and CI/release checks. No frontend deployment, remote configuration change, or production-data test was performed.
