# 飞书频道插件

通过飞书或 Lark 官方机器人 API，把 Cola 接入飞书/Lark 会话。

## 功能

- 接收飞书/Lark 的文本、图片、文件和表情回应事件。
- 从 Cola 向飞书/Lark 发送文本、图片、文件、Markdown 和表情回应消息。
- 固定使用 WebSocket 长连接接收事件，不需要公网服务器。
- 支持通过 `accounts` 配置多个账号。

## 准备工作

- 一个飞书或 Lark 账号。
- 一个带机器人能力的飞书/Lark 应用。
- 该应用的 `App ID` 和 `App Secret`。
- 机器人已发布，并且对需要使用 Cola 的用户可见。
- 机器人已加入需要接收和回复消息的会话。

## 配置流程

### 方式一：一键创建飞书智能体应用（推荐）

飞书开放平台提供了“一键创建飞书智能体应用”能力，适合把 Cola 接入飞书。创建成功后会
直接返回 `App ID` 和 `App Secret`，并预置智能体常用的机器人能力和权限。

1. 打开 [飞书开放平台应用启动器](https://open.feishu.cn/page/launcher)。
2. 按页面提示扫码或登录飞书。
3. 选择创建新应用，或选择一个已有应用继续配置。
4. 创建完成后复制 `App ID` 和 `App Secret`。
5. 在 Cola 插件商店安装 Feishu 插件。
6. 打开 Cola 里的 Feishu 插件设置。
7. 填入 `appId` 和 `appSecret`。
8. `domain` 选择 `feishu`；如果你使用国际版 Lark，选择 `lark`。
9. 在 `authorizedOpenIds` 中填入允许使用 Cola 的飞书用户 `open_id`，多个值用逗号分隔。如果不知道获取方式，可以在保存 `appId` 和 `appSecret` 后见[获取用户 open_id](#获取用户-open_id)。
10. 保存设置，并按 Cola 提示重启或重载 gateway。

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
5. 在 `authorizedOpenIds` 中填入允许使用 Cola 的飞书用户 `open_id`，多个值用逗号分隔。
6. 保存设置，并按 Cola 提示重启或重载 gateway。

Feishu 插件固定使用 WebSocket 长连接模式，不需要公网 HTTP 回调地址。

#### 7. 把机器人加入会话

群聊中，打开群设置，进入 `群机器人`，添加你创建的机器人。很多飞书群聊配置下，用户需要
@机器人 才会触发 Cola 回复。

单聊中，直接在飞书里搜索机器人名称并发起会话。如果你的 Cola 部署启用了私聊身份配对，
需要先把发送者的 `open_id` 加入 `authorizedOpenIds`，保存配置并重载 gateway 后，再让
该用户给机器人发一条消息完成绑定。

## 获取用户 open_id

`authorizedOpenIds` 需要填写飞书/Lark 用户的 `open_id`，通常以 `ou_` 开头。

最简单的方式是先让需要使用 Cola 的用户给机器人发一条消息。插件收到
未授权用户的消息时，会直接回复一段配对提示，里面包含发送者的 `open_id`，例如：

````text
Cola Feishu: access not configured.

Your Feishu open_id:
```
ou_xxx
```
````

复制其中的 `ou_xxx`，填入 `authorizedOpenIds`，保存设置并重载 gateway 后，让该用户再给
机器人发一条消息即可自动完成绑定。

如果需要从日志排查，也可以搜索新版本插件的提示：

```text
[plugin:feishu] Skipping Feishu message from unauthorized sender ou_xxx
```

如果你使用的是旧版本插件，也可能看到 host 层日志：

```text
[plugin:feishu] Ignoring message from unbound sender: ou_xxx
```

如果你在飞书开放平台调试事件，也可以从 `im.message.receive_v1` 事件 payload 的
`sender.sender_id.open_id` 字段获取。管理员或开发者也可以通过飞书开放平台的用户 ID
查询工具/API 获取用户的 `open_id`。

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

| 字段                | 必需 | 默认值   | 说明                                                               |
| ------------------- | ---- | -------- | ------------------------------------------------------------------ |
| `appId`             | 是   |          | 飞书/Lark 机器人应用 ID，例如 `cli_xxx`。                          |
| `appSecret`         | 是   |          | 机器人应用密钥。请作为 secret 保存。                               |
| `domain`            | 否   | `feishu` | 国内飞书用 `feishu`，国际版 Lark 用 `lark`。                       |
| `authorizedOpenIds` | 否   |          | 允许绑定到 Cola 的发送者 `open_id`，多个值用逗号、空格或换行分隔。 |

多账号高级配置可以直接使用 `accounts` 对象：

```json
{
  "accounts": {
    "default": {
      "appId": "cli_xxx",
      "appSecret": "secret",
      "domain": "feishu",
      "authorizedOpenIds": "ou_xxx,ou_yyy"
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
- 群聊里是否需要 @机器人。
- 发送者的 `open_id` 是否已加入 `authorizedOpenIds`。
- 保存配置并重载 gateway 后，是否让该 `open_id` 发过消息触发自动绑定。
- 未授权用户是否收到了 `Cola Feishu: access not configured.` 提示；如果没有，请检查
  `im:message:send_as_bot` 权限。

### 图片或文件失败

添加 `im:resource` 权限，发布新版本，然后重载 Cola gateway。
