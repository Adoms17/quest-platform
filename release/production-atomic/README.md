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
