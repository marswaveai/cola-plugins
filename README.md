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

Run lint:

```bash
pnpm lint
```

Check formatting:

```bash
pnpm fmt:check
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
|       `-- README.md
|-- scripts/
|   `-- build-registry.ts
|-- docs/
|   `-- store-oss.md
`-- pnpm-workspace.yaml
```

Each plugin package follows the same shape:

- `package.json` declares package metadata, build scripts, and `cola.plugin` /
  `cola.channel` manifest fields.
- `README.md` contains user-facing setup and usage notes for that plugin.
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
      "docsPath": "https://github.com/marswaveai/cola-plugins/blob/main/plugins/example/README.md"
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
2. Create `plugins/<id>/README.md` for the plugin's setup and usage notes.
3. Add `cola.plugin.id`, `cola.plugin.entry`, and `cola.plugin.minSdkVersion`.
4. Add `cola.channel` metadata for the store and settings UI, including a
   GitHub README URL in `cola.channel.docsPath`.
5. Export a `defineChannel(...)` entrypoint from `src/index.ts`.
6. Add focused tests for protocol parsing, outbound formatting, and config
   handling where the plugin has non-trivial behavior.
7. Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, and
   `pnpm test`. You can run `pnpm build:registry` to inspect the generated
   store metadata, but do not commit its output.

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

## Plugin localization

Plugin i18n is available in SDK 0.1.0. Register locale files in `package.json`:

```json
{
  "cola": {
    "plugin": { "id": "example", "entry": "./dist/index.js" },
    "channel": {
      "label": "Example",
      "description": "Example messaging channel",
      "i18n": {
        "en": "./locales/en.json",
        "zh-CN": "./locales/zh-CN.json"
      }
    }
  }
}
```

Each file is a flat JSON object mapping message keys to strings. The reserved
`label` and `description` keys supply the channel name and introduction, including
its store card before installation. Other keys belong to the plugin. Files must
be JSON files inside the package, referenced by relative paths without `..`.

```json
{
  "label": "示例",
  "description": "通过示例渠道与 Cola 对话",
  "config.token": "机器人令牌",
  "auth.timeout": "登录在 {{seconds}} 秒后超时，请重试。"
}
```

Keep the existing string `meta.label` and `meta.description` as defaults. Use
`pluginMessage(key, fallback, params?)` for configuration field labels,
descriptions, placeholders and option labels; gateway status messages; auth
status messages; command descriptions, argument descriptions and replies; and
`unauthorizedHint`. Plain strings continue to work. Keep IDs, command names,
configuration keys and option values stable.

```ts
import { pluginMessage, PluginLocalizedError } from "@marswave/cola-plugin-sdk";

const field = {
  key: "botToken",
  type: "password" as const,
  label: pluginMessage("config.token", "Bot token"),
};

throw new PluginLocalizedError(
  pluginMessage("auth.timeout", "Login timed out after {{seconds}} seconds. Please retry.", {
    seconds: 30,
  }),
  { cause: originalError },
);
```

Messages serialize as `{ key, fallback, params? }`. Parameters accept strings,
numbers, booleans and nested messages. Use `joinPluginText(parts, separator?)`
to compose dynamic command replies without translating them early. Plugin keys
are isolated; they cannot overwrite Cola or another plugin's translations.

The desktop resolves text in its current UI language and updates visible text
when the language changes. The server translates command replies and authorization
hints at delivery using Cola's language setting. For a plugin that sends text
directly through its platform client, use `await ctx.runtime.i18n!.text(message)`
at the send site. A host supporting i18n provides this optional runtime capability.

Each field falls back from the exact UI locale to `en`, then to its original
fallback. Empty translations count as missing. Simplified and traditional Chinese
do not fall back to one another. Partial catalogs are supported. Cola currently
has `en`, `es`, `ja`, `ko`, `zh-CN` and `zh-TW` UI languages. Locale keys are
case-insensitive; use canonical tags in package metadata.

The UI displays a localized error summary and expandable original details.
`ChannelStatusResult.details` can carry raw status diagnostics separately from `message`.
Unexpected errors get a generic localized summary; logs keep original errors.
Malformed or missing locale files produce runtime diagnostics and use fallback
text rather than preventing the plugin from loading. Publish validation rejects
missing files, invalid JSON, non-string values, escaping paths and mismatched
`{{parameter}}` names across translations. A catalog is limited to 1 MiB.

`resolvePluginText`, `validatePluginCatalog` and `validatePluginTranslations` are
pure helpers. Node tooling can import `loadPluginTranslations` from
`@marswave/cola-plugin-sdk/i18n-files`; pass `{ strict: true }` for publish
validation, or `{ onWarning }` to retain valid locales on runtime failures.

Publish SDK 0.1.0 before releasing plugins that depend on it, and set
`cola.plugin.minColaVersion` to the first released Cola version supporting i18n.
In `cola-plugins`, `pnpm build:registry` validates all declared catalogs and embeds
only `label`/`description` translations in the store index. Release packaging
copies every registered locale file; the installed host reads the full catalogs.
