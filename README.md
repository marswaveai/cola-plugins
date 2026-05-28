# Cola Plugins

[简体中文](README.zh-CN.md)

Official channel plugins for Cola.

This repository is a pnpm workspace for plugins that connect Cola to external
messaging services and devices. Each plugin is built as a standalone package
under `plugins/*` and is published through the Cola plugin registry.

## Status

This project is currently in beta. Plugin APIs, manifest fields, registry
metadata, and release behavior may change in breaking ways before a stable
release.

## Requirements

- Node.js 22 or newer
- pnpm 10

The current plugin manifests declare `@marswave/cola-plugin-sdk` as a
dependency. Fresh public checkouts can install dependencies directly from npm.

## Getting Started

Install dependencies:

```bash
pnpm install
```

Build all plugins:

```bash
pnpm build
```

Run type checks:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Rebuild the plugin registry locally:

```bash
pnpm build:registry
```

This writes an ignored `registry.json` preview for inspection. Contributors do
not need to commit generated registry output.

## Repository Layout

```text
.
|-- plugins/
|   `-- <id>/
|-- scripts/
|   `-- build-registry.ts
|-- docs/
|   `-- store-oss.md
`-- pnpm-workspace.yaml
```

Each plugin package follows the same shape:

- `package.json` declares package metadata, build scripts, and `cola.plugin` /
  `cola.channel` manifest fields.
- `src/index.ts` exports a `defineChannel(...)` entrypoint.
- `dist/index.js` is the built entrypoint consumed by Cola.

## Plugin Manifest

Cola reads plugin metadata from each plugin package's `package.json`:

```json
{
  "cola": {
    "plugin": {
      "id": "example",
      "entry": "./dist/index.js",
      "minSdkVersion": "0.5.0"
    },
    "channel": {
      "label": "Example",
      "description": "Example Cola channel plugin",
      "aliases": ["ex"],
      "docsPath": "/channels/example"
    }
  }
}
```

The plugin registry is generated from these manifests. It contains the latest
public version of each plugin and the tarball URL used by the Cola plugin store.
The generated `registry.json` is a release artifact and is ignored by git.

## Developing a Plugin

Build or typecheck a single plugin with pnpm filters:

```bash
pnpm --filter "./plugins/<id>" run build
pnpm --filter "./plugins/<id>" run typecheck
```

When adding a new plugin:

1. Create `plugins/<id>/package.json`.
2. Add `cola.plugin.id`, `cola.plugin.entry`, and `cola.plugin.minSdkVersion`.
3. Add `cola.channel` metadata for the store and settings UI.
4. Export a `defineChannel(...)` entrypoint from `src/index.ts`.
5. Add focused tests for protocol parsing, outbound formatting, and config
   handling where the plugin has non-trivial behavior.
6. Run `pnpm build`, `pnpm typecheck`, and `pnpm test`. You can run
   `pnpm build:registry` to inspect the generated store metadata, but do not
   commit its output.

## Registry and Release

The public registry is served from:

```text
https://files.colaos.ai/plugins/registry.json
```

Tarballs are stored under:

```text
plugins/{id}/{id}-{version}.tar.gz
```

The release workflow runs on `main` when a plugin `package.json` changes, and it
can also be triggered manually. It builds changed plugins, uploads immutable
tarballs to OSS, rebuilds `registry.json`, and uploads the generated registry
with `no-cache`.

See `docs/store-oss.md` for the maintainer release flow and manual re-publish
steps.

## Security Notes

Plugins bridge Cola with external accounts and devices. Treat tokens, app
secrets, QR login results, account files, and message attachments as sensitive.

- Do not commit account data, generated credentials, or local runtime state.
- Keep secrets in Cola configuration fields marked as secret/password.
- Redact tokens, app IDs, session identifiers, and account IDs in logs where
  practical.
- Do not overwrite already published plugin tarballs. Bump the plugin version
  for every public release.

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
