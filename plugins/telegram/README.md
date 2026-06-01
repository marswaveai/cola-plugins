# Telegram Channel Plugin

Connect Cola to Telegram through a Telegram bot and the Bot API long-polling
endpoint.

## Features

- Receives Telegram text messages, captions, and lightweight summaries for common non-text message types.
- Sends Cola replies back to the originating Telegram chat or forum topic.
- Supports Telegram typing indicators.
- Only accepts messages from explicitly configured Telegram chat IDs.

## Requirements

- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- The bot added to every group or forum topic where Cola should participate.
- BotFather privacy settings configured for the messages you want the bot to receive.

This plugin uses long polling. On gateway start it calls `deleteWebhook`, because
Telegram does not allow `getUpdates` long polling while a webhook is configured.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the bot token.
2. Install the Telegram plugin from the Cola plugin store.
3. Add the bot to the target chat, group, or forum topic.
4. Send a message in each target chat and collect its chat ID.
5. Enter the token and allowed chat IDs in the plugin settings.
6. Check `/telegram status` in Cola.

## Configuration

| Field                   | Required | Default | Description                                                          |
| ----------------------- | -------- | ------- | -------------------------------------------------------------------- |
| `botToken`              | Yes      |         | Telegram bot token from BotFather.                                   |
| `allowedChatIds`        | Yes      |         | Comma-separated chat IDs accepted by the plugin.                     |
| `pollingTimeoutSeconds` | No       | `25`    | Long-poll timeout for `getUpdates`.                                  |
| `dropPendingUpdates`    | No       | `false` | Whether to discard pending Telegram updates when the gateway starts. |
| `ignoreBotMessages`     | No       | `true`  | Skip messages sent by Telegram bot accounts.                         |

## Finding Chat IDs

1. Create the bot and copy its token from BotFather.
2. Add the bot to the target private chat, group, supergroup, or forum topic.
3. Send a message in that chat. In groups, mention the bot or disable BotFather
   privacy mode if the bot cannot see normal group messages.
4. Call Telegram `getUpdates` with the bot token:

```bash
TOKEN="123456:ABC-DEF..."
curl "https://api.telegram.org/bot${TOKEN}/getUpdates"
```

Look for `message.chat.id` in the JSON response. Private chat IDs are usually
positive numbers; group and supergroup IDs are usually negative numbers, and
supergroups often start with `-100`. Configure multiple IDs as a comma-separated
list:

```text
123456789,-1001234567890
```

If `getUpdates` says a webhook is active, clear it first:

```bash
curl "https://api.telegram.org/bot${TOKEN}/deleteWebhook"
```

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
