# Reviewed atomic backend package

Application SHA256: `a060c3e9cb87e3e73957b80bda39e913a1a2d2933bbad996020d8971b50bed6f`.
Size: 2613787 bytes. PostgreSQL 17.6; baseline 99 to final 335 ledger entries.

The application SQL is unchanged from the isolated rollback/success validation.
No credentials, raw production catalog, or production row export is included.
The workflow is manual-only and retains the production environment reviewer gate.
Its artifact commit and workflow commit are separately pinned. Inspect mode is read-only.
Apply requires reviewed managed prerequisites, fresh preflight and explicit security approval.
Never rerun an uncertain apply: reconcile metadata first. No commercial activation,
Edge deployment, secret writes, blanket database push, or B17 tests are included.

Inspect failures emit only fixed diagnostic reasons and explicitly allowlisted SQLSTATEs.
Raw stderr, connection strings, credentials, query text and failure stdout are never
printed. Unknown/localized errors remain PSQL_FAILURE_UNCLASSIFIED; classification is
a troubleshooting hint, not proof of successful authentication or target identity.
There is still one read-only attempt and no automatic retry. Apply behavior is unchanged.

Runner changes must be committed first, then REVIEWED_ARTIFACT_SHA in the workflow
must pin that immutable commit in a subsequent commit. Merely changing the runner on
main would leave the old artifact executing. The SQL hash and bytes remain fixed.
The workflow still requires the actual post-merge main SHA as expected_workflow_sha;
the artifact SHA and PR head are not substitutes. Merge and another inspect dispatch
require separate authorization and the existing production environment review.

Offline validation: python -m unittest discover -s scripts/production-atomic -p 'test_*.py' -v
These mocked tests never connect to a database and do not validate production access.
