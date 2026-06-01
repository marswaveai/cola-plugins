# Feishu Channel Plugin

Connect Cola to Feishu or Lark through the official bot API.

## Features

- Receives text, image, file, and reaction events from Feishu or Lark.
- Sends text, image, file, markdown, and reaction messages from Cola.
- Uses WebSocket events by default, with webhook mode available for advanced deployments.
- Supports multiple accounts through the `accounts` config object.

## Requirements

- A Feishu or Lark custom app with the bot capability enabled.
- The app ID and app secret for that bot.
- Bot event subscriptions and message permissions configured in the Feishu or Lark developer console.
- The bot invited to the chats where Cola should receive and send messages.

## Setup

1. Install the Feishu plugin from the Cola plugin store.
2. Open the plugin settings in Cola.
3. Enter the bot `appId` and `appSecret`.
4. Select `feishu` or `lark` for the tenant domain.
5. Keep `connectionMode` as `websocket` unless your deployment requires an HTTP webhook endpoint.
6. Save the settings and check `/feishu status` in Cola.

## Configuration

| Field            | Required | Default     | Description                                                |
| ---------------- | -------- | ----------- | ---------------------------------------------------------- |
| `appId`          | Yes      |             | Feishu or Lark bot app ID, for example `cli_xxx`.          |
| `appSecret`      | Yes      |             | Bot app secret. Store it as a secret value.                |
| `domain`         | No       | `feishu`    | Use `lark` for Lark tenants.                               |
| `connectionMode` | No       | `websocket` | Use `webhook` only when you expose a webhook endpoint.     |
| `enabled`        | No       | `true`      | Set to `false` to keep an account configured but inactive. |

Advanced multi-account configuration can use the `accounts` object directly:

```json
{
  "accounts": {
    "default": {
      "appId": "cli_xxx",
      "appSecret": "secret",
      "domain": "feishu",
      "connectionMode": "websocket",
      "enabled": true
    }
  }
}
```

When `connectionMode` is `webhook`, webhook-specific options such as
`encryptKey`, `verificationToken`, `webhookPort`, and `webhookPath` can be set
on the account object.

## Commands

```text
/feishu status
/feishu accounts
```

Aliases:

```text
/fs status
/lark status
```
