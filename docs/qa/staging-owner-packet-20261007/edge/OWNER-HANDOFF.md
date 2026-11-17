# participant-avatar: owner Dashboard handoff

Scope: only Supabase staging `jeugfyaqzfgdvfhdxfht`, function `participant-avatar`, exact candidate `8c9ae161d6a9d2a9c51be2940a14d945128752eb`. No frontend release, other functions, new credentials, roles or schedulers.

## DB checkpoint and RPC comparison

Owner reported corrected 02 success at 09:52 UTC and 03 output at 09:53 UTC. At 2026-10-07 09:53:52 UTC, owner explicitly confirmed the whole 03 ran without errors (Sentinel_3b2e1cdf05e481919fae2c9e0d2ce958). Therefore **owner-run DB catalog postcheck PASS**: exact 328 history set, both new source hashes/names, private PNG bucket with 1 MiB limit, six named Storage policies, RLS on three new tables and the stated RPC/table ACL assertions. This does not establish hosted adversarial acceptance or complete remote function-body equivalence.

All nine reported RPC metadata match the migration/default-grant expectations (ACL ordering is irrelevant):

| RPC group | EXECUTE grantees | Security/config |
| --- | --- | --- |
| begin_participant_avatar; can_edit_participant_identity; claim_participant_avatar_cleanup; save_participant_identity | postgres, authenticated, service_role | SECURITY DEFINER; search_path=pg_catalog, public |
| claim_expired_participant_avatars; claim_failed_participant_avatar; confirm_participant_avatar_upload; finish_participant_avatar_cleanup | postgres, service_role | SECURITY DEFINER; search_path=pg_catalog, public |
| record_my_account_activity | postgres, authenticated, service_role | SECURITY DEFINER; empty search_path |

03 executes all assertions in its DO block before the history, bucket, policy and final nine-RPC SELECTs, then ROLLBACK. The owner's whole-file confirmation closes the selection ambiguity. Do not rerun 02.

## Route and exact source tree

No callable Supabase/IAB/browser/computer tool is exposed to this agent. No CLI/login-role or credential route was attempted. Supabase documents Dashboard deployment via Edge Functions -> Deploy a new function -> Via Editor, but support for preserving this particular sibling `_shared` layout has not been verified in the owner's UI: https://supabase.com/docs/guides/functions/quickstart-dashboard .

Packet files are exact byte copies of the reviewed candidate. Git diff against the candidate for these sources and `supabase/config.toml` is empty. Required virtual source tree:

```
participant-avatar/index.ts
_shared/participantAvatarEndpoint.js
_shared/participantAvatarPng.js
```

Keep the existing entrypoint and all relative imports:

- index imports `npm:@supabase/supabase-js@2.112.3` and `../_shared/participantAvatarEndpoint.js`.
- endpoint imports `./participantAvatarPng.js`.
- PNG module has no further imports.

| Packet-relative file | SHA256 |
| --- | --- |
| participant-avatar/index.ts | 68C0EF694EAB109A0A44F8E67811D8374CFB202FCF81E1B2D58C121B8DF5EB32 |
| _shared/participantAvatarEndpoint.js | 087171C672109F368E27CA3D6C20EA994188F4DD41369704FC9E17CBF31FF3A0 |
| _shared/participantAvatarPng.js | 62DBAC9441D3791139722576ECD95CBCA358AA90B4DD87DF00F88D07E43B0790 |

## Owner steps

1. Verify Dashboard URL `/project/jeugfyaqzfgdvfhdxfht/` and title `quest-platform-staging`; open Edge Functions. Select only `participant-avatar`, or create that exact name if absent. If it already exists, record its current version/ID and retain its source through the existing Dashboard download before replacing it. Do not expose environment values.
2. In the editor, supply the three files above with their unchanged relative paths and entrypoint. **If the UI cannot preserve the sibling `_shared` directory/import layout, stop and report that limitation.** Do not flatten/rewrite imports, invent an import map, substitute a template, add a bundler/dependency or switch to CLI/API credentials.
3. Ensure JWT verification is enabled: **verify_jwt=true**. The repository setting is `[functions.participant-avatar] verify_jwt = true`; it is not automatically applied merely by pasting source. Preserve the source's Auth getUser check and exact origin list below. Do not change authentication settings to accommodate a deployment/test error.
4. Once layout and JWT setting are verified, deploy only this function using the Dashboard. Capture function name, project ref, version/deployment ID, UTC time and JWT-enabled setting. Return this metadata; no keys/tokens or authenticated request headers.

Existing trusted runtime variables referenced by code are SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Use existing platform-provided variables; do not copy/read/rotate their values or create secrets. If unavailable, stop. Service-role use remains only inside this server function.

Exact current allowlist (do not narrow/broaden during this release):

- https://stage.qvesta.ru
- https://app.qvesta.ru
- http://127.0.0.1:4173
- http://127.0.0.1:5174
- http://localhost:5174

## Safe initial verification after deployment

Record deployment/import/startup errors without raw headers or user data. In the Dashboard tester, a POST with no Authorization (and separately an intentionally invalid token, not a real user's token) must be denied with 401. These calls should never reach authorized upload or cleanup; do not paste a service-role key to make them pass. The tester may auto-fill authorization: confirm it is absent for the no-auth check without exporting its value.

An OPTIONS request with Origin https://stage.qvesta.ru and Access-Control-Request-Method POST should return 204 plus matching Access-Control-Allow-Origin if it reaches this handler. Preserve verify_jwt=true on unexpected gateway/CORS outcomes and report them. This tests initial routing/CORS only, not a successful authorized avatar lifecycle.

Then run the separately approved synthetic hosted acceptance: legitimate profile upload/revision, wrong actor/revoked profile denial, invalid JWT, private/public Storage read denial, direct-write denial and revision/cleanup races. Use only synthetic records and existing application authentication; do not extract credentials, create CLI roles, add cron or issue raw Storage SQL deletes. That acceptance is **NOT RUN** here. Frontend remains HOLD until backend acceptance and Cloudflare route/trigger mapping are confirmed.

## Local checks / status

Exact candidate source diff and all three packet/source hashes PASS. Import closure, current allowlist, verify_jwt=true and RPC metadata comparison reviewed from repository sources. No Edge code was changed. No Edge deployment or hosted invocation was performed by this agent; no new remote resources or local containers were created for this handoff. Final lint/build results are in the handoff response.

## Deployment completed through checked CLI route

2026-10-07 10:08:04.120 UTC (server timestamp): participant-avatar deployed to staging jeugfyaqzfgdvfhdxfht, ID 5a4c93b2-46cd-4648-9969-6418d02bc16d, version 1, ACTIVE, verify_jwt=true. Used installed CLI 2.116.0 `functions deploy participant-avatar --project-ref jeugfyaqzfgdvfhdxfht --use-api` and existing managed auth. No login/link/DB CLI, credential extraction, new role, secrets operation or frontend release. Earlier mandatory UI-route statements are superseded: command-specific source review established a separate permitted Functions API route.

Read-only functions list confirmed metadata; functions download --use-api to a fresh isolated local folder returned exactly three source files. Every SHA256 matches the candidate and table above byte-for-byte. Receipt: [DEPLOYMENT-20261007.json](DEPLOYMENT-20261007.json). The first list wrapper failed to select the CLI output shape; the list API itself succeeded. The corrected metadata-only parser confirmed the unique target record; there was no redeploy or auth retry.

Hosted security smoke and full avatar lifecycle remain NOT RUN. Next gate is approved synthetic backend acceptance, then Cloudflare mapping; frontend remains HOLD. Downloaded source and metadata are retained under .review.local for independent verification. No containers or persistent helper processes were created.
