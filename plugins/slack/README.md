# Slack 频道插件

通过 Slack 官方 Socket Mode，把 Cola 接入 Slack 会话。无需公网回调地址，机器人用一条
WebSocket 长连接接收事件。

## 功能

- 接收 Slack 的文本、图片、文件消息，以及私聊和频道里 @机器人的消息。
- 从 Cola 向 Slack 发送文本、图片、文件、Markdown（自动转 Slack mrkdwn）和表情回应。
- 支持流式「草稿预览」：先发占位消息，再随回复增量 `chat.update`（需宿主 SDK 支持，见
  [流式草稿](#流式草稿)）。
- 用 👀 reaction + `assistant.threads.setStatus` 模拟「正在输入」。
- 按白名单授信：私聊按用户 ID、频道按频道 ID。
- 固定使用 Socket Mode 长连接，不需要公网服务器。

## 准备工作

- 一个 Slack workspace，并且有创建应用的权限。
- 一个 Slack App，开启 Socket Mode。
- 该应用的 **Bot token**（`xoxb-` 开头）和 **App-level token**（`xapp-` 开头）。

## 配置流程

### 1. 创建 Slack App

1. 打开 [Slack API: Your Apps](https://api.slack.com/apps)，点击 `Create New App`。
2. 选择 `From scratch`，填写名称（例如 `Cola`）并选择目标 workspace。

### 2. 开启 Socket Mode

1. 进入 `Settings` → `Socket Mode`，打开开关。
2. 系统会提示创建一个 **App-level token**，scope 选择 `connections:write`。
3. 复制生成的 `xapp-...` token，这就是配置里的 `appToken`。

### 3. 配置 Bot 权限（OAuth Scopes）

进入 `Features` → `OAuth & Permissions`，在 `Bot Token Scopes` 添加：

| Scope             | 用途                                          |
| ----------------- | --------------------------------------------- |
| `chat:write`      | 以机器人身份发送和编辑消息。                  |
| `files:read`      | 下载用户上传的图片、文件。                    |
| `files:write`     | 向会话上传图片、文件。                        |
| `reactions:write` | 添加/移除表情回应（也用于「正在输入」👀）。   |
| `reactions:read`  | 读取表情回应上下文。                          |
| `users:read`      | 解析发送者的昵称、头像。                      |
| `assistant:write` | 可选。在 thread 下显示原生「is typing…」状态。|

### 4. 订阅事件（Event Subscriptions）

进入 `Features` → `Event Subscriptions`，打开开关（Socket Mode 下无需填 Request URL），
在 `Subscribe to bot events` 添加：

| 事件               | 用途                       |
| ------------------ | -------------------------- |
| `message.im`       | 接收私聊消息。             |
| `message.channels` | 接收公开频道里的消息。     |
| `message.groups`   | 接收私有频道里的消息。     |
| `app_mention`      | 接收 @机器人 的提及。      |

### 5. 安装应用

进入 `Settings` → `Install App`，把应用安装到 workspace，复制 `Bot User OAuth Token`
（`xoxb-...`），这就是配置里的 `botToken`。

### 6. 配置 Cola 插件

1. 在 Cola 插件商店安装 Slack 插件。
2. 打开 Slack 插件设置，填入：
   - `botToken`：`xoxb-...`
   - `appToken`：`xapp-...`
   - `allowedIds`：逗号分隔的白名单（见下文）。
3. 保存设置，并按 Cola 提示重启或重载 gateway。

### 7. 把机器人加入会话

- **私聊**：在 Slack 里搜索机器人名称直接发起会话。
- **频道**：在目标频道里 `/invite @你的机器人`。频道里必须 @机器人 才会触发 Cola 回复。

## 访问授信（谁能使用 Cola）

通过配置里的 `allowedIds` 控制，逗号分隔，可混合两类 ID：

- **私聊**：填发送者的 Slack 用户 ID（`U` 开头）。
- **频道**：填频道 ID（`C` 开头），整个频道授信，且频道里必须 @机器人 才触发。

### 怎么拿到用户 ID / 频道 ID

最简单的方式是让对方先触发一次。未授信的用户私聊机器人、或在频道里 @机器人时，插件会
回复一段提示，里面带好对应的用户 ID 和频道 ID，复制填进 `allowedIds` 即可。

也可以在 Slack 客户端里：点用户头像 → `Copy member ID`；或在频道详情底部查看 Channel ID。

## 流式草稿

如果宿主 Cola 的 SDK 支持 `sendDraft`，插件会在回复生成过程中先发一条占位消息，再随
累积文本增量 `chat.update`，结束时替换为最终文本；若回复没有正文则删除占位消息。SDK 不
支持时，插件回落为一次性 `sendText`，不影响使用。

## 测试

1. 给机器人发私聊消息，或在已加入机器人的频道里 @机器人。
2. 在 Cola 中运行：

```text
/slack status
/slack config
```

`status` 显示连接状态、机器人、team 和最近事件时间；`config` 显示脱敏后的 token 与白名单
数量。如果显示未连接，请检查 `botToken` / `appToken` 是否正确，并确认保存后已重载 gateway。

## 配置字段

| 字段                | 必需 | 默认值  | 说明                                                       |
| ------------------- | ---- | ------- | ---------------------------------------------------------- |
| `botToken`          | 是   |         | Bot User OAuth Token，`xoxb-` 开头。请作为 secret 保存。   |
| `appToken`          | 是   |         | App-level token，`xapp-` 开头，需 `connections:write`。    |
| `allowedIds`        | 是   |         | 逗号分隔的用户 ID（私聊）和频道 ID（频道）白名单。         |
| `ignoreBotMessages` | 否   | `true`  | 是否忽略其他机器人/自己发的消息。                          |
| `unfurlLinks`       | 否   | `false` | 发送消息时是否展开链接和媒体预览。                         |

配置 UI 只暴露 `botToken`、`appToken`、`allowedIds`。`ignoreBotMessages` 与 `unfurlLinks`
保留默认值，需要时可在 `channels.json` 里设置。

## 常见问题

### 机器人收到消息但不回复

检查：

- 应用已安装到 workspace，且发消息的用户/频道在 `allowedIds` 里。
- 机器人已加入目标频道；频道里是否 @机器人。
- Bot Token Scopes 是否包含 `chat:write`。
- Event Subscriptions 是否订阅了对应的 `message.*` / `app_mention` 事件。
- 未授信用户是否收到了带 ID 的提示；如果没有，多半是缺 `chat:write`。

### 图片或文件失败

- 下载失败、日志提示 `files:read`：给应用补 `files:read` 权限并重新安装。
- 上传失败：补 `files:write` 权限。

### 「正在输入」不显示

`assistant.threads.setStatus` 需要 `assistant:write` 且应用启用了 Assistant 能力；缺失时
插件只会用 👀 reaction 兜底，不影响回复。
