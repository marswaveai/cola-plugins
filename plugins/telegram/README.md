# Telegram Channel Plugin

Connect Cola to Telegram through a Telegram bot and the Bot API long-polling
endpoint.

## Features

- Receives Telegram text messages, captions, and lightweight summaries for common non-text message types.
- Sends Cola replies back to the originating Telegram chat or forum topic.
- Supports Telegram typing indicators.
- Can limit accepted messages to specific chat IDs.

## Requirements

- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- The bot added to every group or forum topic where Cola should participate.
- BotFather privacy settings configured for the messages you want the bot to receive.

This plugin uses long polling. On gateway start it calls `deleteWebhook`, because
Telegram does not allow `getUpdates` long polling while a webhook is configured.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the bot token.
2. Install the Telegram plugin from the Cola plugin store.
3. Enter the token in the plugin settings.
4. Add the bot to the target chat, group, or forum topic.
5. Send a message to the bot and check `/telegram status` in Cola.

## Configuration

| Field                   | Required | Default                    | Description                                                          |
| ----------------------- | -------- | -------------------------- | -------------------------------------------------------------------- |
| `botToken`              | Yes      |                            | Telegram bot token from BotFather.                                   |
| `apiBaseUrl`            | No       | `https://api.telegram.org` | Bot API base URL. Override only for a compatible proxy.              |
| `allowedChatIds`        | No       | All chats                  | Comma-separated chat IDs accepted by the plugin.                     |
| `pollingTimeoutSeconds` | No       | `25`                       | Long-poll timeout for `getUpdates`.                                  |
| `dropPendingUpdates`    | No       | `false`                    | Whether to discard pending Telegram updates when the gateway starts. |
| `ignoreBotMessages`     | No       | `true`                     | Skip messages sent by Telegram bot accounts.                         |

To find a chat ID, temporarily leave `allowedChatIds` empty, send a message to
the bot, and inspect the Telegram plugin logs or the delivered Cola session
metadata.

## Commands

```text
/telegram status
/telegram config
```

Alias:

```text
/tg status
```

## Notes

- Telegram message text is sent as plain text. Cola markdown is not passed to Telegram as MarkdownV2.
- File and media downloads are not implemented yet; non-text Telegram messages without captions are delivered as short textual summaries.
