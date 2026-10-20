# Full implemented MVP: integration preparation

Status: **DRAFT / NOT DEPLOYABLE / no production GO**. Prepared 2026-10-20.
Scope includes all implemented App, Admin, Website and Market/SHOP capabilities.
This package does not activate sales, provision resources, configure credentials,
change hosted policies, apply SQL, dispatch workers or deploy anything.

## Pinned inputs and conflict decisions

| Source | Exact commit |
| --- | --- |
| Production main / PR base | 1621969901c7269581ae6dd9cd88a85f41519faa |
| Staging | 6075dc9755357fedd2e26c21f0655f16ceeb6a51 |
| Market branch | 220ce8bd660ef860c29500775cbd4fc911010a28 |

The staging merge preserves production ancestry, rather than replacing main history.
All 57 conflicted paths use the later staging implementation. Independent static
review established exact historical tree equivalence:

- main PR50 `014e6ab3` and staging `254198ba`: tree `16702d9b17f0b69d5c19c266982b909000948173`;
- main PR57 `fbf11446` and staging `30aa656a`: tree `97f19dfe2003015e207d4a78372f2db514ed54b7`;
- main PR61 `fbb47325` and staging `ed026f24`: tree `5cffaa878b1c8538c044191b4b80b09296fc26d5`.

Later staging changes retain and evolve those capabilities. All 99 main migration
blobs match staging. The first integrated tree is exactly staging plus main's
`.github/workflows/billing-stage-worker.yml`. Its schedule gate is preserved;
the staging runner preserves default behavior and adds optional single-order use.
No worker is invoked. PR179's manual SHOP workflow is identical in both inputs.
PR180 dependency versions remain: brace-expansion 5.0.12, nested filelist
brace-expansion 2.1.7, fast-uri 3.1.8, serialize-javascript 7.1.2, source-map-js 1.2.2.
Do not replace the integrated lockfile with an older main/staging lockfile.

Market merges cleanly with its 94 added files: frontend/assets, stage contract,
retired workflow, source/credential scanners, passport/public-export helpers and
release documentation. Shared shopMoney sources already match. Later staging
SHOP fixtures/runner are retained, not reverted to the older Market base.
Root Vitest excludes Market because its browser suites use Playwright. Market's
existing unit config runs separately in Market CI with a synthetic OFF build.

## Review artifacts and precise limitations

- `source-manifest.json`: SHA-256 (UTF-8/LF) for 327 historical migration files,
  two separate release migrations, six SHOP test fixtures, 14 Edge source
  entrypoints and their literal imports, and all four frontend import graphs.
  External imports and incomplete runtime/RPC graph coverage are explicit.
  Public assets, CSS url() dependencies and installed npm packages are not covered
  by the literal import graphs; they are not compiled artifact attestations.
- `production-config.review.json`: inert configuration contract, **not** a Wrangler
  or Supabase config. Unknown domains/resources/keys/artifact hashes remain null.
  No executable production deploy config is fabricated while these decisions are open.
- `scripts/production-integration-inventory.mjs`: local static check only.
  No environment reads, network, child processes, SQL or deployment.

The production list_migrations read on 2026-10-20 returned 99 version/name entries,
ending at 20260914210000. This does not freshly attest SQL contents, catalog,
ACL/RLS, extensions, Auth/Storage or live OFF state. 228 source versions are absent
from that ledger; **none are authorized for application**. Stage-only fixtures,
schedule/gate changes and historical assumptions require production classification.
Six SHOP SQL fixtures remain tests, not a deployment migration directory.
The existing candidate manifest remains `local-candidate-not-deployable`.
Local PASS2 replay and PR182 documentation are evidence of isolated reconstruction,
not a production mapping or automatic migration permission.
The exact version set was compared with the saved 2026-10-01 history and matched.
The generator uses that persisted set, not a timestamp cutoff. Regeneration never
refreshes the dated remote evidence.

Stage has three deployed SHOP functions whose source bundles are absent from these
pinned refs: shop-checkout, shop-reconcile, shop-reconciliation-worker. Recover their
reviewed source/provenance before including them in a production release. Their
absence is a release blocker, not an intentional scope exclusion. All implemented
features remain in scope. Do not invent wrappers or import dirty work to fill it.
UNAPPLIED auth/legal candidates are not imported. Historical tracked candidate
SQL stays historical source; its presence grants no permission to execute it.

## Dependency sequence and rollback boundaries

1. Resolve SHOP source provenance and production contracts; classify each pending
   migration and complete the RPC/ACL dependency graph. Pin a final release commit,
   artifact hashes and a reviewed function/schema apply order.
2. Approve resources/domains, public build bindings, per-function server secret
   names/scope, operator access, extension prerequisites and restoration readiness.
   No secret values belong in this package.
3. In a separately authorized release, use only that exact backend manifest with
   new sales/sends OFF and workers quiescent. Choose schema-before-function or
   function-before-schema per compatibility, not a blanket rule. The generic
   deploy-production db push/linked-test/secret-setting workflow is not this release.
4. Publish frontends only after dependencies: App RPC/Auth/Storage; Admin RPC and
   MFA; Website public-tariff RPC; Market SHOP catalog/RPC and production OFF contract.
5. Read back commits, artifact/function versions and OFF state. Do not create
   payments, refunds or orders as an implicit publication check.
6. Commercial activation remains a separate decision after RF infrastructure,
   legal/fiscal/operations, real devices, CONTENT01/I05/I06 and PRE03 evidence.
   B17 remains NOT PROVEN; no denied test is repeated or treated as passed.

Frontend rollback targets must be retained and compatible with the new schema.
Known production App version prefix is 6fc5af9e; full ID must be confirmed before
an actual release. No previous production Admin/Market/Website version is attested.
Do not enable their traffic before readiness. After new durable operation formats,
old handlers may be incompatible: preserve queues/obligations, stop new sends and
use a compatible correction. No automatic reverse SQL or destructive restore.

## Validation and external-state boundaries

Automatic PR CI has no live credential injection or deploy step. General CI uses
synthetic frontend tests and disposable database images; Admin CI uses isolated
GoTrue/PostgREST; Website CI builds both modes. Market CI uses local dummy public
values with sales false. Hosted workflows remain dispatch-only; the pre-existing
main billing schedule is not triggered by this branch or PR.

Independent review found and resolved the Market root-test discovery conflict.
No new B17 runner is added. Live checkout switches must stay unset for local
checks. Existing validation results do not establish production acceptance.

Sources: [production baseline](../../tasks/PROD-PAY-05-production-baseline.md),
[production package plan](../../tasks/PROD-PAY-05-package-plan.md),
[candidate manifest](../../tasks/PROD-PAY-05-candidate-manifest.json),
[Market rollout](../../qa/market-workers-builds/ROLLOUT.md).
Historical documentation restricting SHOP scope is superseded by the user's
full-implemented-MVP decision; technical safety restrictions remain applicable.
