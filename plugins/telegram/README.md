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

`allowedChatIds` must contain Telegram chat IDs, not usernames. For private
chats, the Telegram user ID is also the chat ID.

### Ask @userinfobot

1. Open [@userinfobot](https://t.me/userinfobot) in Telegram.
2. Start the bot.
3. Copy the `Id` value from its reply.
4. Put that value into `allowedChatIds`, save settings, and reload the gateway.

Configure multiple chat IDs as a comma-separated list:

```text
123456789,987654321
```

## Notes

- Cola replies are converted from Markdown to Telegram HTML before sending. Telegram supports a smaller formatting subset than Cola, so unsupported structures such as tables are sent as readable text.
- File and media downloads are not implemented yet; non-text Telegram messages without captions are delivered as short textual summaries.
