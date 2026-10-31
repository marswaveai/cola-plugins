# DingTalk Channel Plugin

Connect Cola to DingTalk through an enterprise internal application robot using
the Stream mode (outbound WebSocket). No public callback URL, domain, or TLS
certificate is required.

## Features

- Receives robot messages (direct chats and @-mentions in group chats) over a
  managed Stream WebSocket connection with automatic reconnect.
- Receives inbound media: images, audio, video and files are downloaded to a
  local temp path and handed to the agent as attachments (up to 50 MB each).
  When a download fails, the message falls back to a short text summary.
- Sends Cola replies back to the originating DingTalk conversation:
  `oToMessages` for direct chats, `groupMessages` for group chats.
- Sends Markdown replies when the model output is markdown-capable.
- Sends image and file replies natively (uploaded to DingTalk via its media
  upload API and sent as `sampleImageMsg` / `sampleFile` robot messages).
- Group chat is opt-in via `groupEnabled`; DingTalk itself only pushes group
  messages that @-mention the robot.

## Requirements

- An enterprise internal application on the
  [DingTalk Open Platform](https://open-dev.dingtalk.com) with:
  - The **robot** application capability added, with the message receive mode
    set to **Stream mode**.
  - A **published version** (unpublished robots do not receive
    `senderStaffId`, which is required for direct-chat replies).
  - The **enterprise robot message sending** permission granted.
- The application's **Client ID (AppKey)** and **Client Secret (AppSecret)**.

## Setup

1. In the DingTalk Open Platform console, create (or reuse) an enterprise
   internal application and copy the Client ID and Client Secret.
2. Under **Application capabilities**, add the **robot** capability and select
   **Stream mode** as the message receive mode, then publish the application
   version.
3. Under **Permissions**, grant the enterprise robot message sending
   permission.
4. Install the DingTalk plugin in Cola and enter the Client ID and Client
   Secret in the plugin settings.
5. For group chats, add the robot to the target group (group settings →
   robots) and enable `groupEnabled` in the plugin settings. Users must
   @-mention the robot in groups.
6. Check `/dingtalk status` in Cola.

## Notes and limits

- The Stream channel is receive-only; replies are sent through the DingTalk
  REST API with an access token cached for its 2-hour validity window.
- Group message payloads are limited to 15000 bytes by DingTalk; Cola splits
  longer replies.
- Incoming media downloads: DingTalk's robot file-download endpoint returns a
  short-lived temporary URL; the plugin downloads to a local temp dir (capped
  at 50 MB per file). Media messages without a usable `downloadCode` (e.g.
  rich-text messages with embedded pictures) remain text summaries.
- Outbound media: images and files are supported. DingTalk's video message
  (`sampleVideo`) additionally requires a cover-image mediaId that cannot be
  derived from the single file Cola provides, so video replies are not enabled.
  Voice uploads are capped at 2 MB by DingTalk; image/video/file at 20 MB.
- Media upload uses DingTalk's legacy OAPI gateway
  (`https://oapi.dingtalk.com/media/upload`), which authenticates with an
  `access_token` form/query field rather than the `x-acs-dingtalk-access-token`
  header used by the newer `api.dingtalk.com` robot endpoints. The token is the
  same one issued by `/v1.0/oauth2/accessToken`.
- Treat the Client Secret as a credential: it is stored in Cola's secret
  configuration fields and is never written to logs or files.

## Security

Do not commit Client ID/Secret values, session webhooks, or message content.
The plugin never persists credentials outside Cola's encrypted configuration.
