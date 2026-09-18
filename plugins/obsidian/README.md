# Cola Plugin: Obsidian

Cola channel plugin that enables chatting with Cola from within Obsidian.

## How It Works

This plugin starts a local WebSocket server (default port 19533) that the [Cola for Obsidian](https://github.com/heran11011/cola-obsidian) plugin connects to. Messages from Obsidian are delivered to Cola with full file context, and Cola's replies are sent back to the Obsidian sidebar.

## Features

- **Local WebSocket Server** — Secure local-only connection (127.0.0.1)
- **Auto Authentication** — Token-based auth, zero configuration for the user
- **File Context** — Receives the currently open file from Obsidian
- **Vault Awareness** — Receives vault file structure on first connection
- **Markdown Support** — Cola's replies are rendered as Markdown in Obsidian

## Installation

Install from Cola's plugin settings, or manually:

1. Build: `npm install && npm run build`
2. Copy the `dist/` folder to `~/.cola/plugins/obsidian/`
3. Copy `package.json` to `~/.cola/plugins/obsidian/`
4. Restart Cola

## Configuration

| Field | Description | Default |
|-------|-------------|---------|
| port | Local WebSocket port | 19533 |

The port only needs to be changed if 19533 is already in use.

## Companion Plugin

This plugin requires the [Cola for Obsidian](https://github.com/heran11011/cola-obsidian) plugin installed in your Obsidian vault.

## Development

```bash
npm install
npm run build
npm run typecheck
```

## License

Apache-2.0
