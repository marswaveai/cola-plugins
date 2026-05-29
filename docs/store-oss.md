# 插件 Store 发布

插件产物与 manifest 通过维护者配置的对象存储和 CDN 发布。公开读取入口是
`https://files.colaos.ai/plugins/registry.json`。上传凭据只配置在 GitHub Actions
Secrets 中,不要写入仓库文档、源码或日志。

## 公开布局

公开 `plugins/` 前缀下有两类对象:

| 对象     | Key                                  | 缓存                                |
| -------- | ------------------------------------ | ----------------------------------- |
| 插件产物 | `plugins/{id}/{id}-{version}.tar.gz` | `max-age=31536000`(不可变,旧版不删) |
| manifest | `plugins/registry.json`              | `no-cache`                          |

## 前端契约

前端固定读取:`https://files.colaos.ai/plugins/registry.json`。
这个 registry 由 release workflow 生成并上传,本仓库不提交生成后的
`registry.json` 文件。
消费端接入方式见 [`plugin-store-integration.md`](plugin-store-integration.md)。

结构(每插件一条 = 最新版):

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "feishu",
      "label": "Feishu",
      "description": "...",
      "version": "0.1.0",
      "minSdkVersion": "0.5.0",
      "aliases": ["lark"],
      "docsPath": "/channels/feishu",
      "downloadUrl": "https://files.colaos.ai/plugins/feishu/feishu-0.1.0.tar.gz"
    }
  ]
}
```

## 维护者配置

Release workflow 从仓库的 GitHub Actions Secrets 读取对象存储 endpoint、region、
目标存储空间和上传凭据。实际值只应配置在 GitHub 仓库设置里,不要复制进公开文件。
上传账号应使用最小权限,只允许写入插件发布所需的对象前缀。

公开域名 `https://files.colaos.ai` 直接写死在 `scripts/build-registry.ts` 的
`DEFAULT_PUBLIC_BASE`;如需临时覆盖(本地/staging),可设环境变量 `OSS_PUBLIC_BASE`。

## 一次性迁移 / 手动重发

在 Actions 里手动运行 `Release` workflow(workflow_dispatch),会忽略版本 diff、
重新构建并上传全部插件,然后刷新 OSS 上的 `plugins/registry.json`。

> 注意:CI 构建要求插件 `package.json` 的 SDK 依赖是真实 npm 规格(非 `link:` 本地路径)。
