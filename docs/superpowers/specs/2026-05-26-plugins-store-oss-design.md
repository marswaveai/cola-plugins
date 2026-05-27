# 插件 Store 迁移到阿里云 OSS — 设计稿

日期:2026-05-26
状态:已确认,待写实现计划

## 背景与目标

现有发布流水线已经在跑:`release.yml` 在插件改动合入 main 时构建并把产物发到
**GitHub Releases**,`registry.json` 作为 manifest 提交在仓库根目录,前端据此安装/更新插件。

GitHub Releases 是临时方案,国内用户下载不友好。目标是把整套流水线迁到
**阿里云 OSS(公共读)**:产物和 manifest 都托管在 OSS,前端从 OSS 上的固定 URL
读取 manifest 进行安装/更新。

构建逻辑本身基本不变,本次本质是"换一个上传目标 + 把 manifest 也推到 OSS"。

## 已确认的决策

- **触发**:插件改动合入 main(沿用现有 `plugins/*/package.json` 版本变化触发)。
  不监听 npm、不做跨仓库触发。所谓"更新 SDK"指的是插件作者在自己的 package.json
  里改 SDK 依赖,属于普通代码改动,合入 main 即触发。
- **构建**:GitHub Action 构建变更的插件 —— 安装它在 package.json 里声明的依赖
  (含从 npm 拉取的 SDK),tsup 打包,staging 出自包含 prod 依赖的目录,打 tar。
- **产物存储**:阿里云 OSS,公共读。一个版本一个 tar 文件,**旧版本不删**。
- **manifest**:沿用现有 `registry.json` 结构(每插件一条 = 最新版),
  `downloadUrl` 指向 OSS;manifest 本身也托管在 OSS 固定 key,前端直接读。
  **只暴露最新版**,不做多版本兼容选版。
- **来源**:第三方通过 PR 提交插件,合入 main 后进 store。
- **实现路线**:路线 A —— 原地改 `release.yml`,最小 diff,复用现有 bash 流程。
  不抽独立发布脚本(留待第三方校验逻辑变重时再做,YAGNI)。

## 架构

### 1. OSS 布局与访问

Bucket(示例名 `cola-plugins`,公共读),两类对象:

| 对象 | Key | 说明 |
|---|---|---|
| 插件产物 | `plugins/{id}/{id}-{version}.tar.gz` | 不可变,一个版本一个文件,旧版不删 |
| manifest | `registry.json` | 固定 key,前端永远读这个 URL |

- 前端固定读:`{PUBLIC_BASE}/registry.json`(`PUBLIC_BASE` = OSS 默认域名或绑定的
  CDN 域名)。
- `downloadUrl` = `{PUBLIC_BASE}/plugins/{id}/{id}-{version}.tar.gz`。
- **缓存策略**(迁 OSS 后最容易踩的坑):
  - tarball:`Cache-Control: max-age=31536000`(内容不可变,可长缓存)。
  - `registry.json`:`Cache-Control: no-cache`(或很短 TTL,如 60s),
    否则发新版后前端会拿到旧 manifest。

### 2. release.yml 的改动

保留:触发条件、版本变化检测、构建、staging 自包含 prod 依赖、打 tar。只换两处:

- **去掉** `gh release create`,**换成** ossutil 把 tarball 上传到
  `oss://$BUCKET/plugins/$plugin/`。
- **幂等**:用 `ossutil stat oss://.../{id}-{version}.tar.gz` 判断该版本产物是否已存在,
  存在则跳过(等价于现有的 `gh release view` 跳过逻辑,并保证版本不可变 —— 不覆盖已发布版本)。
- **manifest 步骤**:构建完重新生成 `registry.json`,然后:
  1. commit 回仓库(git 串行化并发写,作为 source of truth + 审计记录);
  2. ossutil 上传 `registry.json` 到 OSS(设 no-cache)。

  即使本次没有新 tarball(只有 manifest 变化),也要上传 manifest 到 OSS。

### 3. registry.json / build-registry.ts 的改动

只改 `downloadUrl` 模板:从 GitHub Releases 链接改成
`${OSS_PUBLIC_BASE}/plugins/${id}/${id}-${version}.tar.gz`,base 从环境变量读取、
提供默认值。manifest schema 不变,前端契约不变。

### 4. 配置与密钥

- GitHub **Secrets**:
  - `OSS_ACCESS_KEY_ID`
  - `OSS_ACCESS_KEY_SECRET`
  - 建议使用仅对该 bucket 有写权限的 RAM 子账号。
- GitHub **Variables**:
  - `OSS_BUCKET`
  - `OSS_ENDPOINT`(region endpoint)
  - `OSS_PUBLIC_BASE`(下载与 manifest 的公开域名,OSS 默认域名或 CDN 域名)

### 5. 一次性迁移

现有 3 个插件(feishu/wechat/stackchan)的 `downloadUrl` 指向 GitHub Releases。
迁移时跑一次构建,把它们的现有版本产物上传 OSS,重新生成 `registry.json` 并上传。
之后 GitHub Releases 不再使用。

## 外部依赖(用户负责,不在本计划内)

OSS 迁移的代码改动本身**与 SDK 版本无关** —— workflow、build-registry、registry.json、
OSS 配置都不引用任何 SDK 版本号。SDK 版本只存在于每个插件自己的 `package.json` 依赖里。

但**端到端 CI 跑通**有一个外部前提,由用户负责处理,不属于本计划的任务:

- 插件 `package.json` 里 SDK 依赖现在是 `link:/Users/mack/.codex/worktrees/.../plugin-sdk`
  本地路径,CI 上该路径不存在,装依赖会失败。
- 插件按 SDK 0.5.x 写,但 npm 上当前最高只有 0.4.0(`cola-plugin-sdk`:0.1.0–0.4.0)。
- 用户会发布新的 SDK package 到 npm,并把插件依赖从 `link:` 切成真实 npm 规格。
- 在此之前,本计划的 OSS/workflow/manifest 改动可以照常实现与单元验证,
  只是真实的发布构建要等用户切换完 SDK 依赖后才能成功。

## 范围之外(记录,本次不做)

- 第三方 PR 在 CI 中执行 `npm install`(任意安装脚本)的供应链风险加固。
- 私有 bucket / 签名 URL。
- 多版本并存与按 SDK 版本的兼容选版。

## 未决细节(实现时确认)

- OSS 上传工具:ossutil(官方 CLI),在 CI 中下载安装;或用 setup action。
- bucket 实际名称、region endpoint、是否绑定 CDN 域名。
- SDK 的 npm 包名与版本范围(见前置条件)。
- registry.json 并发提交(两次相近合并)时 `git push` 可能冲突,
  需要 rebase/retry —— 沿用现有流程的处理方式即可,属已存在的轻量问题。
