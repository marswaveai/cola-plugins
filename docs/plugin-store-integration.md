# 插件商店接入指南

这份文档面向需要接入 Cola 插件商店的消费端 repo。

## 入口

插件商店读取公开 registry:

```text
https://files.colaos.ai/plugins/registry.json
```

这个文件由 `cola-plugins` 的 release workflow 生成并上传到 OSS。消费端不要依赖
GitHub repo 里的生成文件,也不需要维护 registry 表。

## 数据结构

```ts
type PluginRegistry = {
  version: 1
  plugins: PluginRegistryEntry[]
}

type PluginRegistryEntry = {
  id: string
  label: string
  description?: string
  version: string
  minSdkVersion?: string
  aliases?: string[]
  docsPath?: string
  downloadUrl: string
}
```

`downloadUrl` 指向不可变 tarball:

```text
https://files.colaos.ai/plugins/{id}/{id}-{version}.tar.gz
```

## 推荐流程

1. 打开插件商店时请求 registry。
2. 校验 `version === 1`。
3. 按 `minSdkVersion` 过滤当前宿主不支持的插件。
4. 用 `label`、`description`、`version`、`docsPath` 渲染插件列表。
5. 安装时下载 `downloadUrl` 对应 tarball。
6. 解包后校验包内 `package.json` 的 `cola.plugin.id` 与 registry 的 `id` 一致,且 `cola.plugin.entry` 指向的文件存在。

tarball 是发布时打好的自包含包,包含 `package.json`、`dist/` 和生产依赖。消费端不应在安装阶段运行第三方 install scripts。

## 缓存与失败处理

- `plugins/registry.json` 在 OSS 上使用 `no-cache`,消费端可以在打开商店时重新拉取。
- 建议保存一份 last-known-good registry。网络失败时展示缓存,并提示列表可能不是最新。
- 插件 tarball URL 带版本号且不可变,可以长期缓存。
- 插件从 registry 消失只表示商店不再展示或提供新安装,不应默认删除用户本地已安装插件。

## 本地与测试

消费端建议提供一个 registry URL 覆盖项,例如:

```text
COLA_PLUGIN_REGISTRY_URL=http://localhost:8080/registry.json
```

本地调试时可以在 `cola-plugins` 里运行:

```bash
pnpm build:registry
```

这会生成一个被 git 忽略的 `registry.json` 预览文件,可用本地静态服务暴露给消费端测试。

## 安全要求

- 只通过 HTTPS 读取默认 registry 和 tarball。
- 解包 tarball 时拒绝路径穿越条目。
- 安装前校验 manifest 与 registry 一致。
- 不从 registry 执行代码;registry 只作为展示和下载索引。
- 不把 OSS 上传凭据放进消费端。消费端只需要公开读权限。
