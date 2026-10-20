# Integration validation — 2026-10-20

These are new checks of the integrated source, not production acceptance.

| Check | Result |
| --- | --- |
| Root dependency installation, pinned lockfile | PASS; npm audit reported 0 vulnerabilities |
| Root lint | PASS with existing warnings (React effects/memoization and fixture finally blocks) |
| App production build/PWA | PASS; local build only, no release artifact approval |
| Market lint | PASS |
| Market unit suite | PASS: 13 files, 81 tests |
| Market synthetic local OFF build | PASS |
| Existing billing candidate integrity | PASS: 327 historical migrations and two candidate files; not deployment approval |
| New source inventory / inactive config | PASS; no unresolved literal imports |
| Independent static integration review | No blocking finding for Draft publication; no tests executed by reviewer |
| General whitespace check | Inherited Market CRLF and original OFL license trailing space reported; source bytes preserved |
| B17 / hosted tests / payment operations | NOT RUN; no acceptance claim |

Independent review established the exact historical tree equivalences recorded in
README, checked the main-only workflow/lockfile preservation, and found the root
Vitest/Market discovery conflict, now fixed with a separate Market unit CI.
It confirmed that configs are inert, apply/deploy allowlists empty, and import
graphs are not artifact attestations. Its timestamp-classification concern was
resolved by using the exact saved 99-version ledger set; the 2026-10-20 connector
read was compared against that set and matched exactly.

Root, Admin and Website automatic CI are retained. New Market CI runs only lint,
unit and synthetic local OFF build. No feature-branch push or PR deploy trigger,
live secret injection, worker dispatch or hosted SQL is added. Existing manual
deployment workflows and the main-only gated billing schedule are preserved.
CI terminal results are reported on the PR's exact head; this file does not claim
a future run has passed.

Software-engineering skill was not present in the available skill catalog/local
plugin directories; repository AGENTS instructions were read. The existing dirty
PR182 documentation checkout was preserved. Work uses a separate clone/branch.

## First Draft CI and Website dependency correction

First published head: `3d7cd571a0c91dcee6ece6260dcb245714b882f3`.
Market CI 39473312070 passed. Admin frontend job passed, but isolated Auth/browser
job 118802728023 failed while loading the login form, before filling credentials.
The root cause is not established; this is an open CI blocker, not a B17 result.
Website CI 39473312123 failed audit for source-map-js 1.2.1. The separate Website
lock now pins 1.2.2; no application source or security check was weakened.
Local Website audit reports zero vulnerabilities; production/staging builds and
build-link verification, four Sites tests and two tariff catalog tests pass.
The initial sandboxed build could not read the Vite config path; the authorized
local build outside that filesystem restriction passed. No deployment occurred.
See SHOP-PROVENANCE.md for separately located source-review inputs; they are not
part of the integrated runtime tree.
