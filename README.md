# artbin

A home for game development assets: textures, maps, models, and sounds.

Organize files into folders, preview maps and models in the browser, browse WAD textures, and
import collections from GameBanana, SCMapDB, or local archives. Map previews use
[@jackharrhy/worldview](https://github.com/jackharrhy/worldview).

## development

Use [mise](https://mise.jdx.dev/) for the project toolchain:

```bash
mise install
mise exec -- pnpm install
mise exec -- pnpm run dev
```

Open `http://localhost:5175`. Development includes a local admin account; no OAuth setup needed.

```bash
pnpm run ci       # format checks, lint, typechecks, and tests
pnpm run build   # build the web app
```

The repo contains a Remix web app in `apps/web`, a CLI in `apps/cli`, and shared code in
`packages`. See the [justfile](justfile) for other development commands.

## CLI

```bash
npm install --global artbin
artbin login
artbin scan <path>
```

See the [CLI README](apps/cli/README.md) for imports, downloads, and folder management.
Use `just cli-install` to install the checkout locally.

To release, bump `apps/cli/package.json`, commit and push, then run `npm run publish`.
Use `npm run publish:dry-run` to check the package without publishing.
