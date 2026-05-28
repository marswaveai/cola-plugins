# 插件 Store（阿里云 OSS）

插件产物与 manifest 托管在 colaos 的阿里云 OSS bucket(与 Cola 桌面端 release 同一个
bucket,公开读,CDN 域名 `https://files.colaos.ai`)的 `plugins/` 前缀下。CI 在插件
改动合入 `main` 时自动构建并发布,上传方案与 Cola 桌面端 `build.yml` 一致
(`setup-ossutil` 复合 action + ossutil2)。

## OSS 布局

bucket 根下的 `plugins/` 前缀:

| 对象 | Key | 缓存 |
|---|---|---|
| 插件产物 | `plugins/{id}/{id}-{version}.tar.gz` | `max-age=31536000`(不可变,旧版不删) |
| manifest | `plugins/registry.json` | `no-cache` |

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

## CI 所需配置

复用 Cola 桌面端 `build.yml` 的同名 Secrets(把 cola 仓库里的值复制到本仓库
Settings → Secrets and variables → Actions 即可):

**Secrets**
- `ALIYUN_COLAOS_OSS_ENDPOINT`(如 `oss-accelerate.aliyuncs.com`)
- `ALIYUN_COLAOS_OSS_REGION`(如 `cn-hangzhou`,ossutil2 签名 v4 需要)
- `ALIYUN_HAIWAI_ACCESS_KEY_ID`
- `ALIYUN_HAIWAI_ACCESS_KEY_SECRET`
- `ALIYUN_COLAOS_OSS_BUCKET`

公开域名 `https://files.colaos.ai` 直接写死在 `scripts/build-registry.ts` 的
`DEFAULT_PUBLIC_BASE`;如需临时覆盖(本地/staging),可设环境变量 `OSS_PUBLIC_BASE`。

## 一次性迁移 / 手动重发

在 Actions 里手动运行 `Release` workflow(workflow_dispatch),会忽略版本 diff、
重新构建并上传全部插件,然后刷新 OSS 上的 `plugins/registry.json`。

> 注意:CI 构建要求插件 `package.json` 的 SDK 依赖是真实 npm 规格(非 `link:` 本地路径)。
