# Plugin Upgrade Gate Smoke Fixtures

These local-only fixtures are not part of `plugins/*`, so `pnpm build:registry`
will not publish them.

From the matching Cola worktree, install one fixture at a time:

```bash
pnpm cli:dev plugin install /Users/mack/code/marswave/cola-workspace/cola-plugins/smoke/upgrade-gates/compatible
pnpm cli:dev plugin install /Users/mack/code/marswave/cola-workspace/cola-plugins/smoke/upgrade-gates/min-cola-version
pnpm cli:dev plugin install /Users/mack/code/marswave/cola-workspace/cola-plugins/smoke/upgrade-gates/legacy-min-sdk-version
```

Expected results:

- `compatible` installs and loads on current Cola.
- `min-cola-version` installs but is skipped by the loader with
  `requires Cola >= 99.0.0`.
- `legacy-min-sdk-version` exercises the deprecated compatibility fallback and
  is also skipped with `requires Cola >= 99.0.0`.

To smoke the plugin store install gate, serve this directory and start Cola with
the mock registry:

```bash
cd /Users/mack/code/marswave/cola-workspace/cola-plugins/smoke/upgrade-gates
python3 -m http.server 18765
```

Then start the Cola dev server with:

```bash
COLA_PLUGIN_REGISTRY_URL=http://127.0.0.1:18765/mock-registry.json pnpm dev
```

The store should list the mock entries from `mock-registry.json`. Installing
either future-version entry should fail before download with
`requires Cola >= 99.0.0`.
