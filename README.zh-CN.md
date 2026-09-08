# Cola Plugins

[English](README.md)

Cola 官方频道插件仓库。

这个仓库是一个 pnpm workspace，用来维护连接 Cola 与外部消息服务、设备的插件。每个插件都作为独立 package 放在 `plugins/*` 下，并通过 Cola 插件 registry 发布。

## 项目状态

当前项目处于 beta 阶段。在稳定版发布前，插件 API、manifest 字段、registry 元数据和发布行为都可能发生 breaking changes。

## 环境要求

- Node.js 22 或更新版本
- pnpm 10

当前插件 manifest 会将 `@marswave/cola-plugin-sdk` 声明为依赖。公开仓库首次检出后可以直接从 npm 安装依赖。

## 快速开始

安装依赖：

```bash
pnpm install
```

构建全部插件：

```bash
pnpm build
```

运行类型检查：

```bash
pnpm typecheck
```

运行 lint：

```bash
pnpm lint
```

检查格式：

```bash
pnpm fmt:check
```

运行测试：

```bash
pnpm test
```

本地重新生成插件 registry：

```bash
pnpm build:registry
```

这会写出一个被 git 忽略的 `registry.json` 预览文件，供本地检查。贡献者不需要提交生成出来的 registry。

## 仓库结构

```text
.
|-- plugins/
|   `-- <id>/
|       `-- README.md
|-- scripts/
|   `-- build-registry.ts
|-- docs/
|   `-- store-oss.md
`-- pnpm-workspace.yaml
```

每个插件 package 都遵循相同结构：

- `package.json` 声明 package 元数据、构建脚本，以及 `cola.plugin` / `cola.channel` manifest 字段。
- `README.md` 写该插件自己的安装、配置和使用说明。
- `src/index.ts` 导出 `defineChannel(...)` 入口。
- `dist/index.js` 是构建后的入口文件，由 Cola 加载。

## 插件 Manifest

Cola 会从每个插件 package 的 `package.json` 读取插件元数据：

```json
{
  "cola": {
    "plugin": {
      "id": "example",
      "entry": "./dist/index.js",
      "minSdkVersion": "0.5.0"
    },
    "channel": {
      "label": "Example",
      "description": "Example Cola channel plugin",
      "aliases": ["ex"],
      "docsPath": "https://github.com/marswaveai/cola-plugins/blob/main/plugins/example/README.md"
    }
  }
}
```

插件 registry 由这些 manifest 生成。它记录每个插件当前公开发布的最新版本，以及 Cola 插件商店下载 tarball 时使用的 URL。生成出来的 `registry.json` 属于发布产物，会被 git 忽略。

## 开发插件

可以用 pnpm filter 构建或检查单个插件：

```bash
pnpm --filter "./plugins/<id>" run build
pnpm --filter "./plugins/<id>" run typecheck
```

新增插件时：

1. 创建 `plugins/<id>/package.json`。
2. 创建 `plugins/<id>/README.md`，把该插件自己的安装、配置和使用说明写在这里。
3. 添加 `cola.plugin.id`、`cola.plugin.entry` 和 `cola.plugin.minSdkVersion`。
4. 添加供插件商店和设置界面使用的 `cola.channel` 元数据，并在 `cola.channel.docsPath` 写入 GitHub README 链接。
5. 在 `src/index.ts` 导出 `defineChannel(...)` 入口。
6. 对协议解析、出站格式化、配置处理等非平凡逻辑补充聚焦测试。
7. 运行 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm fmt:check` 和 `pnpm test`。可以用 `pnpm build:registry` 本地检查生成的商店元数据，但不要提交它的输出。

## Registry 与发布

公开 registry 地址：

```text
https://files.colaos.ai/plugins/registry.json
```

插件 tarball 存储路径：

```text
plugins/{id}/{id}-{version}.tar.gz
```

发布 workflow 会在 `main` 分支上的插件 `package.json` 变更时运行，也可以手动触发。它会构建变更插件、上传不可变 tarball 到 OSS、重新生成 `registry.json`，并以 `no-cache` 上传生成的 registry。

维护者发布流程和手动重发步骤见 `docs/store-oss.md`。

## 安全说明

插件会连接 Cola 与外部账号或设备。请将 token、app secret、二维码登录结果、账号文件和消息附件视为敏感数据。

- 不要提交账号数据、生成的凭据或本地运行状态。
- 将密钥放在标记为 secret/password 的 Cola 配置字段中。
- 在可行时，对日志中的 token、app ID、session 标识和账号 ID 做脱敏。
- 不要覆盖已经发布的插件 tarball。每次公开发布都应提升插件版本号。

## License

本仓库使用 Apache License, Version 2.0。详见 `LICENSE`。

## 插件多语言

SDK 0.0.5 新增插件 i18n。在 `package.json` 的 `cola.channel.i18n` 中注册语言文件：

```json
{
  "cola": {
    "plugin": { "id": "example", "entry": "./dist/index.js" },
    "channel": {
      "label": "Example",
      "description": "Example messaging channel",
      "i18n": {
        "en": "./locales/en.json",
        "zh-CN": "./locales/zh-CN.json"
      }
    }
  }
}
```

语言文件是扁平的 JSON 字符串字典。保留键 `label`、`description` 对应渠道名称和简介，
也用于尚未安装的商店卡片；其余 key 由插件定义。文件必须位于插件包内，使用不含 `..`
的相对路径。每个文件最多 1 MiB。

```json
{
  "label": "示例",
  "description": "通过示例渠道与 Cola 对话",
  "config.token": "机器人令牌",
  "auth.timeout": "登录在 {{seconds}} 秒后超时，请重试。"
}
```

保留 `meta.label`、`meta.description` 原有字符串作为默认文案。
配置字段的名称、说明、占位提示和选项名称，渠道状态、登录提示、命令说明及参数说明、
命令回复和 `unauthorizedHint` 均接受 `pluginMessage(key, fallback, params?)`；
旧插件继续传普通字符串。插件 ID、命令名、配置 key 和选项 value 保持稳定。

```ts
import { pluginMessage, PluginLocalizedError } from "@marswave/cola-plugin-sdk";

const field = {
  key: "botToken",
  type: "password" as const,
  label: pluginMessage("config.token", "Bot token"),
};

throw new PluginLocalizedError(
  pluginMessage("auth.timeout", "Login timed out after {{seconds}} seconds. Please retry.", {
    seconds: 30,
  }),
  { cause: originalError },
);
```

文案通过 `{ key, fallback, params? }` 跨进程传递。参数支持字符串、数字、布尔值及嵌套文案。
多行动态命令回复使用 `joinPluginText(parts, separator?)` 组合，保留文案直到展示或发送时
再翻译。各插件的翻译资源独立，不能覆盖 Cola 或其他插件。

桌面按当前界面语言渲染，切换语言时已显示的文案同步更新。服务端在发送命令回复和授权
提示时使用 Cola 设置的语言。插件直接调用平台 API 发送提示时，在发送处调用
`await ctx.runtime.i18n!.text(message)`；支持此功能的宿主会提供该可选运行时能力。

每个字段依次回退：精确匹配当前语言 → `en` → 原有默认文案。空字符串视为缺失，允许
只翻译部分字段或语言。简体和繁体不会互相回退。当前界面支持 `en`、`es`、`ja`、`ko`、
`zh-CN`、`zh-TW`。语言代码匹配忽略大小写，注册时建议使用标准写法。

错误界面显示本地化说明，并提供可展开的原始详情。
`ChannelStatusResult.details` 用于传递独立于 `message` 的原始状态诊断。无法识别的错误使用通用本地化说明，
日志保留原始错误。运行时语言文件缺失或损坏会记录诊断并回退，不会阻止插件加载。
发布校验会拦截文件缺失、JSON 错误、非字符串值、越界路径以及各语言间不一致的
`{{parameter}}` 占位参数。

`resolvePluginText`、`validatePluginCatalog`、`validatePluginTranslations` 是纯函数。
Node 工具可从 `@marswave/cola-plugin-sdk/i18n-files` 导入 `loadPluginTranslations`：
发布时传 `{ strict: true }`，运行时传 `{ onWarning }` 以保留其他有效语言。

先发布 SDK 0.0.5，再发布依赖它的渠道。`cola.plugin.minColaVersion` 必须设置为首次支持
此功能的 Cola 正式版本。`cola-plugins` 的 `pnpm build:registry` 校验所有已声明的语言
文件，只把名称和简介翻译放进商店索引；打包时复制全部注册文件，安装后宿主读取完整字典。
