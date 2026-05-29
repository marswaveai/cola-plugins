# Contributing to Cola Plugins

Thanks for your interest in contributing to Cola Plugins. Issues and pull
requests in English or Chinese are welcome.

This repository contains official Cola channel plugins. It is a lightweight
pnpm workspace where each plugin is a standalone package under `plugins/*`.
The project is currently in beta, so plugin APIs, manifest fields, registry
metadata, and release behavior may still change before a stable release.

## Ways to Contribute

- Fix bugs in existing channel plugins.
- Add focused tests for protocol parsing, outbound formatting, configuration,
  auth, and error handling.
- Improve documentation, examples, and troubleshooting notes.
- Add a new channel plugin when there is a clear user need and a maintainable
  protocol/API integration path.
- Improve security handling around tokens, app secrets, account files, message
  attachments, and logs.

## Before You Start

- Check existing issues and pull requests to avoid duplicate work.
- Open an issue first for new plugins, public API changes, manifest changes,
  registry/release behavior changes, or larger refactors.
- Small bug fixes, tests, and documentation improvements can go straight to a
  pull request.
- Keep each pull request focused. Avoid unrelated formatting or cleanup churn.
- Do not include real tokens, account data, QR login results, app secrets, or
  private message content in issues, commits, logs, screenshots, or tests.

For security-sensitive reports, do not publish exploit details or secrets in a
public issue. Open a minimal issue asking maintainers for a private reporting
channel if the repository does not already provide one.

## Development Setup

Requirements:

- Node.js 22 or newer
- pnpm 10

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

Rebuild the local registry preview:

```bash
pnpm build:registry
```

`pnpm build:registry` writes a local `registry.json` preview. This file is a
generated release artifact and must not be committed.

## Working on One Plugin

Use pnpm filters when iterating on a single plugin:

```bash
pnpm --filter "./plugins/<id>" run build
pnpm --filter "./plugins/<id>" run typecheck
pnpm --filter "./plugins/<id>" run test
```

Some plugins may not have a plugin-local `test` script yet. In that case, run
the repository-level `pnpm test` command before opening a pull request.

## Plugin Requirements

Each plugin package should follow the existing structure:

```text
plugins/<id>/
|-- package.json
|-- src/
|   `-- index.ts
|-- tsconfig.json
`-- tsup.config.ts
```

The plugin package `package.json` should include:

- Package metadata such as `name`, `version`, `description`, `license`, and
  `type`.
- `exports["."]` pointing at the built entrypoint, usually `./dist/index.js`.
- `cola.plugin.id`, `cola.plugin.entry`, and `cola.plugin.minSdkVersion`.
- `cola.channel` metadata used by the Cola plugin store and settings UI.
- A dependency on the published `@marswave/cola-plugin-sdk` package.
- `build` and `typecheck` scripts.

The source entrypoint should export a `defineChannel(...)` integration from
`src/index.ts`.

## Tests

Add focused tests when a change affects behavior that can regress. Good test
targets include:

- Incoming protocol parsing.
- Outbound message formatting.
- Config validation and defaults.
- Auth/session state handling.
- Retry, deduplication, and error paths.
- Device or gateway protocol edge cases.

Prefer small, deterministic tests over broad end-to-end tests that require real
external accounts or devices.

## Generated Files and Secrets

Do not commit:

- `node_modules/` or `.pnpm-store/`
- `dist/`
- `registry.json`
- `*.tsbuildinfo`
- `.env` files
- `.ossutilconfig`
- `plugins/**/accounts.json`
- `plugins/**/accounts/`
- Real credentials, account snapshots, or local runtime state

Use redacted fixtures for tests and examples.

## Versioning and Release Notes

If a plugin change should be published to the public Cola plugin registry, bump
the affected plugin package version in `plugins/<id>/package.json`.

Do not overwrite an already published plugin tarball. Public releases are
versioned and immutable. Maintainers handle the release workflow from `main`;
contributors should not commit generated registry output or upload release
artifacts manually.

## Pull Request Checklist

Before opening a pull request, please make sure:

- The change is scoped to one issue, plugin, or feature area.
- New or changed behavior has focused tests where practical.
- `pnpm build` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test` succeeds, or the pull request explains why a test could not be
  run.
- Generated artifacts and local secrets are not committed.
- User-facing behavior changes are reflected in README or docs when needed.

## License

By contributing, you agree that your contributions are licensed under the
Apache License, Version 2.0, the same license used by this repository.
