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

运行测试：

```bash
pnpm test
```

重新生成插件 registry：

```bash
pnpm build:registry
```

## 仓库结构

```text
.
|-- plugins/
|   `-- <id>/
|-- scripts/
|   `-- build-registry.ts
|-- docs/
|   `-- store-oss.md
`-- registry.json
```

每个插件 package 都遵循相同结构：

- `package.json` 声明 package 元数据、构建脚本，以及 `cola.plugin` / `cola.channel` manifest 字段。
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
      "docsPath": "/channels/example"
    }
  }
}
```

根目录的 `registry.json` 由这些 manifest 生成。它记录每个插件当前公开发布的最新版本，以及 Cola 插件商店下载 tarball 时使用的 URL。

## 开发插件

可以用 pnpm filter 构建或检查单个插件：

```bash
pnpm --filter "./plugins/<id>" run build
pnpm --filter "./plugins/<id>" run typecheck
```

新增插件时：

1. 创建 `plugins/<id>/package.json`。
2. 添加 `cola.plugin.id`、`cola.plugin.entry` 和 `cola.plugin.minSdkVersion`。
3. 添加供插件商店和设置界面使用的 `cola.channel` 元数据。
4. 在 `src/index.ts` 导出 `defineChannel(...)` 入口。
5. 对协议解析、出站格式化、配置处理等非平凡逻辑补充聚焦测试。
6. 运行 `pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm build:registry`。

## Registry 与发布

公开 registry 地址：

```text
https://files.colaos.ai/plugins/registry.json
```

插件 tarball 存储路径：

```text
plugins/{id}/{id}-{version}.tar.gz
```

发布 workflow 会在 `main` 分支上的插件 `package.json` 变更时运行，也可以手动触发。它会构建变更插件、上传不可变 tarball 到 OSS、重新生成 `registry.json`、以 `no-cache` 上传 registry，并在需要时把 registry 变更提交回仓库。

维护者发布流程和手动重发步骤见 `docs/store-oss.md`。

## 安全说明

插件会连接 Cola 与外部账号或设备。请将 token、app secret、二维码登录结果、账号文件和消息附件视为敏感数据。

- 不要提交账号数据、生成的凭据或本地运行状态。
- 将密钥放在标记为 secret/password 的 Cola 配置字段中。
- 在可行时，对日志中的 token、app ID、session 标识和账号 ID 做脱敏。
- 不要覆盖已经发布的插件 tarball。每次公开发布都应提升插件版本号。

## License

本仓库使用 Apache License, Version 2.0。详见 `LICENSE`。
