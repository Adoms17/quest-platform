# Saved SHOP source provenance (read-only assessment, 2026-10-20)

This is a separate source-review input, not an import or deployment approval.
The three pinned Git refs do not contain the three SHOP Edge entrypoints. This
is a provenance gap in this Git package, not evidence that SHOP is unimplemented.

- Saved `shop-r2-stage-package/package-manifest.json`: SHA-256
  `4fcaeaf8620556ba5759f4aa5073fa5713c5f405c646ccec0cc9452f5b79e27d`,
  136 entries, created 2026-10-15T16:45:26.111229Z.
- Its `deploy/supabase/functions` eight source files and corresponding eight
  `rollback-candidate/supabase/functions` files matched their saved hashes when
  read on 2026-10-20. They include checkout, reconcile, worker and five shared files.
- Later `shop-worker-postdeploy-readback/REPORT.json` records a source export at
  2026-10-16T08:47:58.421932Z; archive SHA-256
  `dec00442dd03dce127c06f456776c9f8d5e0257ee72982a6068d83b73f47f7a6`.
  The worker entrypoint and sandboxWorkerHandler differ from the October 15 R2
  source. The report records six source matches; this is historical evidence,
  not a fresh deployed-source attestation.
- `SHOP-PURCHASE-READINESS-20261019.txt` records the later worker compiled bundle
  hash `8b59abaa5477d26489ee498f83773f91bb892e9d507455d6ce69447582ad5399`
  for versions 28/30. Source-to-compiled-bundle equivalence is not established by
  matching version labels or this report alone.

Review the R2 package together with the later worker export; do not substitute
R2's older worker for the later deployed worker. Neither package is automatically
included here. Establish the exact reviewed source-to-deployment chain before
adding the missing SHOP source to a release manifest. No runtime, payment or B17
operation was performed for this assessment. Private actor/order identifiers and
personal filesystem paths are omitted.
