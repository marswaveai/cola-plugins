# 飞书频道插件

通过飞书或 Lark 官方机器人 API，把 Cola 接入飞书/Lark 会话。

## 功能

- 接收飞书/Lark 的文本、图片、文件和表情回应事件。
- 从 Cola 向飞书/Lark 发送文本、图片、文件、Markdown 和表情回应消息。
- 支持私聊和群聊（群聊需 @机器人触发），访问授信由 `cola channel allow[-group]` 统一管理。
- 群聊里 @机器人时，自动补全「上次回复以来」的群聊上下文（见[群聊上下文](#群聊上下文)）。
- 支持 `cola channel login feishu` 扫码一键创建应用并自动回写凭据。
- 固定使用 WebSocket 长连接接收事件，不需要公网服务器。
- 支持通过 `accounts` 配置多个账号。

## 准备工作

- 一个飞书或 Lark 账号。
- 一个带机器人能力的飞书/Lark 应用。
- 该应用的 `App ID` 和 `App Secret`。
- 机器人已发布，并且对需要使用 Cola 的用户可见。
- 机器人已加入需要接收和回复消息的会话。

## 配置流程

### 方式一：扫码一键创建（推荐）

插件内置了飞书开放平台的“一键创建飞书智能体应用”流程：扫码即可创建应用，凭据由插件
通过 SDK 自动回写到配置，无需手动复制 `App ID` / `App Secret`。

1. 在 Cola 插件商店安装 Feishu 插件。
2. 运行：

```text
cola channel login feishu
```

3. 用飞书扫描终端里的二维码并确认。
4. 创建成功后，插件会自动把 `appId`、`appSecret` 和 `domain` 写入 `accounts.default`
   并重载 gateway，扫码用户也会被自动授信，可立即给机器人发消息。

之后再为其他用户或群授信，见[访问授信](#访问授信谁能使用-cola)。

### 方式二：手动创建飞书自建应用

如果你没有一键创建入口，或者需要自己控制权限和发布范围，可以手动创建应用。

#### 1. 创建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/)。
2. 点击右上角创建应用。
3. 选择 `企业自建应用`。
4. 填写应用名称，例如 `Cola`。

如果使用 Lark，请打开 [Lark 开放平台](https://open.larksuite.com/)，其余流程相同。

#### 2. 添加机器人能力

1. 进入应用详情页。
2. 打开 `添加应用能力`。
3. 添加 `机器人` 能力。
4. 确认机器人开关已开启。

路径：`开发者后台` -> 应用详情 -> `添加应用能力` -> `机器人`。

#### 3. 获取应用凭证

在 `凭证与基础信息` 中复制：

- `App ID`，通常以 `cli_` 开头。
- `App Secret`。

请把 `App Secret` 当作密钥保存，不要提交到代码、issue、日志或截图里。

#### 4. 配置权限

打开 `权限管理`，添加这个插件需要的权限。飞书后台中的权限名称可能会变化，优先按权限
标识搜索。

| 权限标识                           | 用途                           |
| ---------------------------------- | ------------------------------ |
| `im:message`                       | 接收和处理单聊、群聊消息。     |
| `im:message:send_as_bot`           | 以机器人身份发送回复。         |
| `im:message:readonly`              | 读取消息详情和表情回应上下文。 |
| `im:resource`                      | 上传和下载图片、文件。         |
| `im:message.p2p_msg:readonly`      | 接收用户发给机器人的单聊消息。 |
| `im:message.group_at_msg:readonly` | 接收群聊里 @机器人的消息。     |

如果后台支持批量导入权限，可以先导入这一组：

```json
{
  "scopes": {
    "tenant": [
      "im:message",
      "im:message:send_as_bot",
      "im:message:readonly",
      "im:resource",
      "im:message.p2p_msg:readonly",
      "im:message.group_at_msg:readonly"
    ]
  }
}
```

如果只需要收发文本消息，可以不申请 `im:resource`。如果 Cola 需要接收或发送图片、文件，
请保留它。

#### 5. 发布应用

1. 打开 `版本管理与发布`。
2. 创建一个版本并填写更新说明。
3. 设置可用范围。
4. 提交发布。

自建应用通常审核很快，但必须发布后，普通用户才能正常使用机器人。

#### 6. 配置 Cola 插件

1. 在 Cola 插件商店安装 Feishu 插件。
2. 打开 Feishu 插件设置。
3. 填入 `appId` 和 `appSecret`。
4. `domain` 选择 `feishu` 或 `lark`。
5. 保存设置，并按 Cola 提示重启或重载 gateway。
6. 给需要使用 Cola 的用户或群授信，见[访问授信](#访问授信谁能使用-cola)。

Feishu 插件固定使用 WebSocket 长连接模式，不需要公网 HTTP 回调地址。

#### 7. 把机器人加入会话

群聊中，打开群设置，进入 `群机器人`，添加你创建的机器人。群聊里必须 @机器人 才会触发
Cola 回复，且该群需要先被授信（见下文）。

单聊中，直接在飞书里搜索机器人名称并发起会话。发送者需要先被授信，未授信用户发消息时，
插件会回复一段包含其 `open_id` 和授信命令的提示。

## 访问授信（谁能使用 Cola）

谁能通过飞书驱动 Cola 由 Cola 的访问网关统一管理，使用 `cola channel` 命令授信，不再
通过插件配置里的名单。授信对象有两类：

- **私聊**：按发送者 `open_id` 授信。
- **群聊**：按群 `chat_id` 授信整群，且群里必须 @机器人 才会触发。

```text
cola channel allow         feishu <open_id>   # 授信一个私聊用户
cola channel revoke        feishu <open_id>   # 取消用户授信
cola channel allow-group   feishu <chat_id>   # 授信整个群
cola channel revoke-group  feishu <chat_id>   # 取消群授信
cola channel allowlist     feishu             # 查看已授信的用户和群
```

### 怎么拿到 open_id / chat_id

最简单的方式是让对方先触发一次。未授信的用户私聊机器人、或在群里 @机器人时，插件会回复
一段提示，里面已经带好待执行的命令，例如：

````text
你还没有被授信，无法使用 Cola。
请管理员执行：
```
cola channel allow feishu ou_xxx
```
````

群聊里则是：

````text
这个群还没有被授信，无法使用 Cola。
请管理员执行：
```
cola channel allow-group feishu oc_xxx
```
````

把命令复制到终端执行即可。同一目标的提示有冷却时间，不会刷屏；未 @机器人的群消息会被
直接忽略，不打扰群成员。

> 从旧版本升级：插件启动时会自动把遗留的 `authorizedOpenIds` 迁移成授信绑定，原有用户
> 不需要重新授信。

## 群聊上下文

群聊里机器人默认只会收到「@它」的消息，看不到群里其他人的发言，被 @ 时容易缺少上下文。
为此，当机器人在已授信的群里被 @ 时，插件会通过飞书「获取会话历史消息」接口拉取该群
**自机器人上次回复以来**的最近消息，拼成一段「仅供参考」的上下文，连同当前这条消息一起
交给 Cola，让回复能理解大家在讨论什么。

- **无需额外权限**：复用已申请的 `im:message` / `im:message:readonly`，前提是机器人已在该群里。
- **作用范围**：仅群聊、仅被 @ 时触发；单聊不受影响。整群共享一段上下文，按群累计。
- **失败不影响回复**：拉取历史失败时只记一条告警日志，机器人照常回复，只是少了上下文。
- **当前限制**：上下文里的图片/文件等只显示占位符（如 `[图片]`），发言人以 `open_id` 标注；
  服务重启后首次被 @ 会改为拉取最近若干条。被动接收群里全部消息（需敏感权限
  `im:message.group_msg`）作为后续增强，暂未启用。

## 测试

1. 给机器人发单聊消息，或在已添加机器人的群里 @机器人。
2. 在 Cola 中运行：

```text
/feishu status
/feishu accounts
```

别名：

```text
/fs status
/lark status
```

如果显示没有活跃账号，请检查 Cola 插件设置里的 `appId` / `appSecret`，并确认保存后已经
重启或重载 gateway。

## 配置字段

| 字段        | 必需 | 默认值   | 说明                                         |
| ----------- | ---- | -------- | -------------------------------------------- |
| `appId`     | 是   |          | 飞书/Lark 机器人应用 ID，例如 `cli_xxx`。    |
| `appSecret` | 是   |          | 机器人应用密钥。请作为 secret 保存。         |
| `domain`    | 否   | `feishu` | 国内飞书用 `feishu`，国际版 Lark 用 `lark`。 |

谁能使用 Cola 不再通过配置字段控制，改用 `cola channel allow[-group]` 授信，见
[访问授信](#访问授信谁能使用-cola)。

多账号高级配置可以直接使用 `accounts` 对象：

```json
{
  "accounts": {
    "default": {
      "appId": "cli_xxx",
      "appSecret": "secret",
      "domain": "feishu"
    }
  }
}
```

连接方式由插件固定为 WebSocket 长连接，不需要在账号配置中设置。

## 常见问题

### 一键创建的“飞书智能体应用”和 Aily 智能伙伴应用是一回事吗？

不是。这里推荐的是飞书开放平台的“一键创建飞书智能体应用”，它会创建一个可用于开放
平台 API 的机器人应用，并返回 `App ID` / `App Secret`。

飞书 Aily / 智能伙伴平台是飞书自己的智能体编排平台，不能直接替代当前 Cola 插件。除非
它也给出可用于开放平台机器人 API 的 `App ID` / `App Secret`，否则不能直接填到这里。

### 机器人收到消息但不回复

检查：

- 应用已经发布，并且发送消息的用户在可用范围内。
- 机器人已经加入目标会话。
- 权限包含收消息和以机器人身份发消息的 scope。
- 群聊里是否 @机器人；该群是否已用 `cola channel allow-group feishu <chat_id>` 授信。
- 私聊发送者是否已用 `cola channel allow feishu <open_id>` 授信。可用
  `cola channel allowlist feishu` 查看当前授信列表。
- 未授信用户是否收到了带授信命令的提示；如果没有，请检查 `im:message:send_as_bot` 权限。

### 图片或文件失败

添加 `im:resource` 权限，发布新版本，然后重载 Cola gateway。
