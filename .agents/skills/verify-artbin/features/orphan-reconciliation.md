# Orphan reconciliation

## Sub-features

Disk scanning, orphan adoption/deletion, missing-record cleanup, rejected-file cleanup, empty inbox cleanup, hashing, and duplicate cleanup.

## How to get to it (user POV)

As an administrator, open Admin, choose Orphans, select Scan uploads, then choose the appropriate action for a reported discrepancy.

## Driving it with Playwright

Create an orphan only inside the runner's isolated `public/uploads`, scan through the UI, assert the reported count/path, choose Adopt orphan files, and verify the success notice plus database row. Add a separate isolated fixture for destructive cleanup paths.

## Gotchas

Bulk actions apply to all values submitted by the scan result. Never run mutation flows against production or a shared uploads tree. Rescan immediately before acting because the server revalidates current orphan paths.
