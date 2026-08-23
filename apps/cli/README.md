# artbin CLI

Scan local game directories, import assets, inspect an artbin server, download folder ZIPs, and
organize server folders.

## Install

```bash
npm install --global artbin
artbin login
```

`artbin login` uses `https://artbin.jackharrhy.dev` by default. Pass another server URL to connect
to a self-hosted instance.

## Commands

```text
artbin login [server-url]
artbin logout
artbin scan <path>
artbin import <path> [--folder <slug>] [--dry-run]
artbin add <path> [--folder <slug>] [--dry-run]

artbin folders list [--tree] [--all] [--json]
artbin folders show <slug> [--json]
artbin pull <slug> [destination] [--force] [--json]
artbin folders rename <slug> <new-name> [--dry-run] [--yes] [--json]
artbin folders move <slug> --to <destination-or-root> [--dry-run] [--yes] [--json]
```

All authenticated users can inspect and download public folders. Regular-user uploads are sent to
the review inbox. Creating, renaming, and moving folders requires an administrator account.

Folder mutations preview their impact before confirmation. Use `--dry-run` to inspect a change and
`--json` for scripts or other tooling.
