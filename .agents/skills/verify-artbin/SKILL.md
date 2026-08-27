---
name: verify-artbin
description: Verify Artbin changes through isolated, real-browser user flows with durable screenshots, logs, and state assertions. Use after implementing or reviewing Artbin UI, routes, authentication, uploads, folders, search, admin mutations, orphan reconciliation, or BSP viewing; use before declaring an Artbin change complete.
---

# Verify Artbin

Validate behavior through the same HTTP and browser surfaces a user exercises. Treat unit and route tests as complementary, not as a substitute for this verification.

## Launch

Run from the repository root with the mise-managed toolchain:

```bash
mise exec -- node .agents/skills/verify-artbin/scripts/verify-artbin.mjs
```

The runner starts its own development server on an unused loopback port with a temporary SQLite database, public directory, upload directory, and temp directory. Development auth provisions an isolated local administrator. Never point mutation-heavy flows at production or a shared development database.

Use `--evidence <directory>` to choose the output location. Otherwise evidence is written beneath `artifacts/verification/artbin/` using a UTC timestamp.

## Doctor

Before driving manually, confirm:

- `mise exec -- node --version` satisfies the repository engine.
- `mise exec -- pnpm --version` matches `packageManager` in `package.json`.
- dependencies are installed with `mise exec -- pnpm install --frozen-lockfile`.
- Chromium is available with `mise exec -- pnpm --filter @artbin/web exec playwright install chromium` when the runner reports a missing browser.

The runner checks server readiness and records server output. A readiness failure is a product/setup failure; do not continue with browser assertions against a half-started app.

## Drive

Run the default suite after relevant changes. It drives several independent user-visible flows in one isolated library:

1. Open the library and confirm the authenticated administrator surface.
2. Create a folder through the Add modal.
3. Upload a file through the folder upload UI and search for it.
4. Place an unindexed file on isolated disk, scan through Admin > Orphans, and adopt it through the UI.
5. Confirm both uploaded and adopted files through the database and filesystem.

Prefer accessible roles, labels, and visible text over CSS selectors. Wait for observable outcomes (URL, visible item, notice, database row), not arbitrary sleeps. Read [features/README.md](features/README.md) before verifying a narrower or optional surface.

For a new mutation-heavy feature, extend the runner or add a focused script before considering verification complete. Exercise the success path and at least one meaningful failure or boundary path when practical.

## Evidence

The runner preserves screenshots at important mutation states, `report.json` with assertions, `console.json` with browser errors, and `server.log` with application output.

Report the evidence directory and summarize each flow as pass/fail. Inspect screenshots rather than assuming their existence proves correct rendering. Any unexpected browser error, failed HTTP request, or server error must be explained or treated as a failure.

## Cleanup

The runner closes Chromium, terminates only the exact process group it started, and removes only its temporary runtime directory. It preserves the evidence directory. Never kill Node processes by name and never remove the repository's normal `apps/web/public/uploads` directory.

If interrupted, use the PID and runtime directory recorded in `report.json` or terminal output to clean up the exact owned resources.

## Helpers

- `scripts/verify-artbin.mjs`: isolated end-to-end runner for the core mutation flows.
- `features/README.md`: feature-map index and routing guide for focused verification.
