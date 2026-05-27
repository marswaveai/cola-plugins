# 插件 Store 迁移到阿里云 OSS — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把插件发布流水线从 GitHub Releases 迁到阿里云 OSS(公共读),产物与 manifest 都托管到 OSS,前端从 OSS 固定 URL 读取 `registry.json` 安装/更新。

**Architecture:** 沿用现有 `release.yml` 的「检测版本变化 → 构建 → staging → 打 tar」流程(路线 A,最小改动)。只把发布目标从 `gh release create` 换成 `ossutil cp` 上传到 OSS;`registry.json` 重新生成后既 commit 回仓库(source of truth)又上传到 OSS。`build-registry.ts` 的 `downloadUrl` 改成 OSS 公开 URL。

**Tech Stack:** GitHub Actions、bash、ossutil v1.7.18(阿里云 OSS CLI)、Node + tsx、tsup、vitest。

**Spec:** `docs/superpowers/specs/2026-05-26-plugins-store-oss-design.md`

**外部前提(用户负责,不阻塞本计划的代码实现,但阻塞真实发布构建):** 插件 `package.json` 的 SDK 依赖当前是 `link:` 本地路径且 npm 上只有到 0.4.0;用户会发布新 SDK 并把依赖切成真实 npm 规格。本计划所有改动与 SDK 版本无关,可照常实现与单元验证。

---

## 配置约定(贯穿全计划)

OSS 的具体坐标是用户的环境配置,在以下两处体现,**值由用户提供**:

- 代码默认值:`scripts/build-registry.ts` 里的 `DEFAULT_PUBLIC_BASE` 常量(本地运行用)。
- CI 配置:仓库的 GitHub Secrets / Variables(真实发布用)。

| 名称 | 类型 | 示例值 | 用途 |
|---|---|---|---|
| `OSS_ACCESS_KEY_ID` | Secret | (RAM 子账号 AK) | ossutil 鉴权 |
| `OSS_ACCESS_KEY_SECRET` | Secret | (RAM 子账号 SK) | ossutil 鉴权 |
| `OSS_ENDPOINT` | Variable | `oss-cn-hangzhou.aliyuncs.com` | ossutil region endpoint |
| `OSS_BUCKET` | Variable | `cola-plugins` | 目标 bucket 名 |
| `OSS_PUBLIC_BASE` | Variable | `https://cola-plugins.oss-cn-hangzhou.aliyuncs.com` | 下载/manifest 公开域名(OSS 默认域名或 CDN) |

> 计划中出现的 `cola-plugins` / `oss-cn-hangzhou.aliyuncs.com` 均为示例占位,实现时按用户实际 bucket 替换。

---

## File Structure

- `scripts/build-registry.ts` — **Modify**:抽出可测试的纯函数 `entryFromPackage`,`downloadUrl` 改用 OSS 公开 URL,主流程加 `isMain` 守卫以便被测试导入。
- `scripts/build-registry.test.ts` — **Create**:`entryFromPackage` 的单元测试。
- `package.json`(根) — **Modify**:加 `vitest` devDep 与 `test` 脚本。
- `.github/workflows/release.yml` — **Modify**:加 `workflow_dispatch` 触发与「手动重发全部」检测;加 ossutil 安装+配置;发布改 ossutil 上传;manifest 上传 OSS。
- `docs/store-oss.md` — **Create**:OSS bucket 配置、所需 Secrets/Variables、前端 manifest URL 契约、一次性迁移步骤。

---

## Task 1: build-registry.ts 改用 OSS 下载 URL(TDD)

**Files:**
- Modify: `scripts/build-registry.ts`
- Create: `scripts/build-registry.test.ts`
- Modify: `package.json`(根)

- [ ] **Step 1: 给根仓库装 vitest 并加 test 脚本**

Run:
```bash
pnpm add -D -w vitest
```

然后在根 `package.json` 的 `scripts` 里加一行 `test`(放在 `build:registry` 之后):

```json
  "scripts": {
    "build": "pnpm -r --filter './plugins/*' run build",
    "typecheck": "pnpm -r --filter './plugins/*' run typecheck",
    "build:registry": "tsx scripts/build-registry.ts",
    "test": "vitest run"
  },
```

- [ ] **Step 2: 写失败的测试**

Create `scripts/build-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { entryFromPackage } from './build-registry'

const base = 'https://cdn.example.com'
const pkg = {
  version: '1.2.3',
  description: 'pkg desc',
  cola: {
    plugin: { id: 'demo', entry: './dist/index.js', minSdkVersion: '0.5.0' },
    channel: {
      label: 'Demo',
      description: 'chan desc',
      aliases: ['d'],
      docsPath: '/channels/demo',
    },
  },
}

describe('entryFromPackage', () => {
  it('builds an OSS download URL at plugins/{id}/{id}-{version}.tar.gz', () => {
    const entry = entryFromPackage(pkg, base)
    expect(entry?.downloadUrl).toBe('https://cdn.example.com/plugins/demo/demo-1.2.3.tar.gz')
  })

  it('strips a trailing slash from the public base', () => {
    const entry = entryFromPackage(pkg, 'https://cdn.example.com/')
    expect(entry?.downloadUrl).toBe('https://cdn.example.com/plugins/demo/demo-1.2.3.tar.gz')
  })

  it('prefers channel label/description over package-level fields', () => {
    const entry = entryFromPackage(pkg, base)
    expect(entry?.label).toBe('Demo')
    expect(entry?.description).toBe('chan desc')
  })

  it('returns undefined when id/entry/version is missing', () => {
    expect(entryFromPackage({ version: '1.0.0' }, base)).toBeUndefined()
    expect(entryFromPackage({ cola: { plugin: { id: 'x', entry: './e.js' } } }, base)).toBeUndefined()
  })
})
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `pnpm test`
Expected: FAIL —— `entryFromPackage` 还没从 `build-registry.ts` 导出(import 报错/undefined）。

- [ ] **Step 4: 重写 build-registry.ts**

把整份 `scripts/build-registry.ts` 替换为(抽出 `entryFromPackage` / `buildRegistry`,主流程加 `isMain` 守卫,`downloadUrl` 改 OSS):

```ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

// 下载与 manifest 的公开根 URL。CI 通过 OSS_PUBLIC_BASE 覆盖;
// 默认值是 bucket 的公开域名,供本地运行用 —— 部署时替换成真实 bucket。
const DEFAULT_PUBLIC_BASE = 'https://cola-plugins.oss-cn-hangzhou.aliyuncs.com'

export type RegistryEntry = {
  id: string
  label: string
  description?: string
  version: string
  minSdkVersion?: string
  aliases?: string[]
  docsPath?: string
  downloadUrl: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry))
  return items.length > 0 ? items : undefined
}

export function entryFromPackage(pkg: unknown, publicBase: string): RegistryEntry | undefined {
  if (!isRecord(pkg)) return undefined

  const cola = isRecord(pkg.cola) ? pkg.cola : undefined
  const plugin = isRecord(cola?.plugin) ? cola.plugin : undefined
  const channel = isRecord(cola?.channel) ? cola.channel : undefined

  const id = normalizeString(plugin?.id)
  const entry = normalizeString(plugin?.entry)
  const version = normalizeString(pkg.version)
  if (!id || !entry || !version) return undefined

  const label = normalizeString(channel?.label) ?? id
  const description = normalizeString(channel?.description) ?? normalizeString(pkg.description)
  const minSdkVersion = normalizeString(plugin?.minSdkVersion)
  const aliases = normalizeStringList(channel?.aliases)
  const docsPath = normalizeString(channel?.docsPath)
  const base = publicBase.replace(/\/+$/, '')

  return {
    id,
    label,
    ...(description ? { description } : {}),
    version,
    ...(minSdkVersion ? { minSdkVersion } : {}),
    ...(aliases ? { aliases } : {}),
    ...(docsPath ? { docsPath } : {}),
    downloadUrl: `${base}/plugins/${id}/${id}-${version}.tar.gz`,
  }
}

export function buildRegistry(pluginsDir: string, publicBase: string) {
  const entries: RegistryEntry[] = []
  for (const name of fs.readdirSync(pluginsDir)) {
    const dir = path.join(pluginsDir, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const pkgPath = path.join(dir, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    const entry = entryFromPackage(pkg, publicBase)
    if (entry) entries.push(entry)
  }
  return { version: 1, plugins: entries }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const pluginsDir = path.resolve(__dirname, '..', 'plugins')
  const publicBase = process.env.OSS_PUBLIC_BASE ?? DEFAULT_PUBLIC_BASE
  const registry = buildRegistry(pluginsDir, publicBase)
  const outPath = path.resolve(__dirname, '..', 'registry.json')
  fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
  console.log(`Wrote registry.json with ${registry.plugins.length} plugin(s)`)
}
```

> 把 `DEFAULT_PUBLIC_BASE` 改成用户真实的 OSS 公开域名(若与示例不同)。

- [ ] **Step 5: 运行测试,确认通过**

Run: `pnpm test`
Expected: PASS,4 个用例全过。

- [ ] **Step 6: 重新生成 registry.json 并确认 URL 变了**

Run: `pnpm build:registry`
Expected: 控制台 `Wrote registry.json with 3 plugin(s)`;`registry.json` 里每个 `downloadUrl` 形如 `https://cola-plugins.oss-cn-hangzhou.aliyuncs.com/plugins/feishu/feishu-0.1.0.tar.gz`(不再是 github releases 链接)。

- [ ] **Step 7: Commit**

```bash
git add scripts/build-registry.ts scripts/build-registry.test.ts package.json pnpm-lock.yaml registry.json
git commit -m "feat: build-registry 改用 OSS 下载 URL,抽出可测试单元"
```

---

## Task 2: release.yml 加手动触发与「重发全部」检测

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 加 workflow_dispatch 触发器**

把文件顶部 `on:` 块替换为:

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'plugins/*/package.json'
  workflow_dispatch:
```

`workflow_dispatch` 用于一次性迁移与手动重发(忽略版本 diff,重发全部插件)。

- [ ] **Step 2: 让「Detect version changes」在手动触发时选中全部插件**

把 `Detect version changes` 步骤的 `run:` 块替换为:

```bash
          RELEASES=""
          for dir in plugins/*/; do
            plugin=$(basename "$dir")
            pkg="$dir/package.json"
            [ -f "$pkg" ] || continue

            NEW_VER=$(node -p "require('./$pkg').version")

            if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
              # 手动触发:重发全部插件,忽略版本 diff
              RELEASES="$RELEASES $plugin:$NEW_VER"
              continue
            fi

            OLD_VER=$(git show HEAD~1:"$pkg" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null || echo "")
            if [ "$NEW_VER" != "$OLD_VER" ]; then
              RELEASES="$RELEASES $plugin:$NEW_VER"
            fi
          done
          echo "releases=$RELEASES" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: 校验 YAML 合法**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```
Expected: 输出 `yaml ok`,无异常。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): release 支持手动触发重发全部插件"
```

---

## Task 3: release.yml 安装并配置 ossutil

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 在「Detect version changes」之后、「Build & release」之前插入 ossutil 安装+配置步骤**

放置位置很重要:必须在 `Detect version changes`(`id: versions`)**之后**,在发布/上传步骤**之前**。无 `if:` 条件 —— job 本身已被 `on:` 触发器限制(只在 package.json 变化或手动触发时跑),后续的 manifest 上传也需要 ossutil,所以这一步总是执行。

```yaml
      - name: Setup ossutil
        env:
          OSS_ENDPOINT: ${{ vars.OSS_ENDPOINT }}
          OSS_ACCESS_KEY_ID: ${{ secrets.OSS_ACCESS_KEY_ID }}
          OSS_ACCESS_KEY_SECRET: ${{ secrets.OSS_ACCESS_KEY_SECRET }}
        run: |
          curl -fsSL -o ossutil https://gosspublic.alicdn.com/ossutil/1.7.18/ossutil64
          chmod +x ossutil
          sudo mv ossutil /usr/local/bin/ossutil
          ossutil config -e "$OSS_ENDPOINT" -i "$OSS_ACCESS_KEY_ID" -k "$OSS_ACCESS_KEY_SECRET"
          ossutil --version
```

> Secrets 在 Actions 日志里自动脱敏;`ossutil config` 会写入 `~/.ossutilconfig` 供后续步骤复用。

- [ ] **Step 2: 校验 YAML 合法**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```
Expected: `yaml ok`。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): 安装并配置 ossutil"
```

---

## Task 4: 发布从 GitHub Releases 换成 ossutil 上传

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 替换「Build & release」步骤**

把整个 `Build & release` 步骤(`if:` 到循环结束)替换为:

```yaml
      - name: Build & upload to OSS
        if: steps.versions.outputs.releases != ''
        env:
          OSS_BUCKET: ${{ vars.OSS_BUCKET }}
        run: |
          for entry in ${{ steps.versions.outputs.releases }}; do
            plugin="${entry%%:*}"
            version="${entry##*:}"
            tarball="${plugin}-${version}.tar.gz"
            key="plugins/${plugin}/${tarball}"

            echo "=== Publishing $plugin@$version ==="

            # 版本不可变:已存在则跳过(旧版不覆盖、不删除)
            if ossutil stat "oss://$OSS_BUCKET/$key" &>/dev/null; then
              echo "oss://$OSS_BUCKET/$key already exists, skipping"
              continue
            fi

            pnpm --filter "./plugins/$plugin" run build

            # 打一个自包含目录(含 prod 依赖)
            staging="staging/$plugin"
            mkdir -p "$staging"
            cp "plugins/$plugin/package.json" "$staging/"
            cp -r "plugins/$plugin/dist" "$staging/dist"
            (cd "$staging" && npm install --omit=dev --ignore-scripts)

            tar -czf "$tarball" -C "$staging" .

            ossutil cp "$tarball" "oss://$OSS_BUCKET/$key" -f \
              --meta "Cache-Control:max-age=31536000"

            rm -rf "$staging" "$tarball"
          done
```

变化点:删掉 `gh release view` 跳过判断(改用 `ossutil stat`)、删掉 `gh release create`(改用 `ossutil cp` 上传到 `plugins/{id}/{id}-{ver}.tar.gz`,设长缓存)、删掉步骤上的 `GH_TOKEN` env。

- [ ] **Step 2: 校验 YAML 合法**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```
Expected: `yaml ok`。

- [ ] **Step 3: 确认不再引用 GitHub Releases**

Run:
```bash
grep -n "gh release" .github/workflows/release.yml || echo "no gh release references"
```
Expected: 输出 `no gh release references`。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): 产物改为上传阿里云 OSS,弃用 GitHub Releases"
```

---

## Task 5: manifest 重新生成后上传到 OSS

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 替换「Rebuild registry」步骤**

把整个 `Rebuild registry` 步骤替换为(**不加 `if:`**,与原步骤一致 —— 即使只改了元数据没升版本,也要刷新 manifest):

```yaml
      - name: Rebuild & publish registry
        env:
          OSS_BUCKET: ${{ vars.OSS_BUCKET }}
          OSS_PUBLIC_BASE: ${{ vars.OSS_PUBLIC_BASE }}
        run: |
          pnpm build:registry

          # 上传 manifest 到 OSS(短缓存,保证前端及时拿到新版本)
          ossutil cp registry.json "oss://$OSS_BUCKET/registry.json" -f \
            --meta "Cache-Control:no-cache"

          # commit 回仓库作为 source of truth(仅在内容变化时)
          if git diff --quiet registry.json; then
            echo "registry.json unchanged"
          else
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add registry.json
            git commit -m "chore: update registry.json"
            git push
          fi
```

变化点:加 `OSS_PUBLIC_BASE` env(让 `build:registry` 生成真实 OSS 链接)、加一行 `ossutil cp registry.json ... no-cache`。

- [ ] **Step 2: 校验 YAML 合法**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```
Expected: `yaml ok`。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): manifest 重新生成后上传到 OSS"
```

---

## Task 6: 文档 —— OSS 配置与前端契约

**Files:**
- Create: `docs/store-oss.md`

- [ ] **Step 1: 写文档**

Create `docs/store-oss.md`:

```markdown
# 插件 Store（阿里云 OSS）

插件产物与 manifest 托管在阿里云 OSS(公共读)。CI 在插件改动合入 `main`
时自动构建并发布。

## OSS 布局

| 对象 | Key | 缓存 |
|---|---|---|
| 插件产物 | `plugins/{id}/{id}-{version}.tar.gz` | `max-age=31536000`(不可变,旧版不删) |
| manifest | `registry.json` | `no-cache` |

## 前端契约

前端固定读取:`{OSS_PUBLIC_BASE}/registry.json`。

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
      "downloadUrl": "{OSS_PUBLIC_BASE}/plugins/feishu/feishu-0.1.0.tar.gz"
    }
  ]
}
```

## CI 所需配置

在仓库 Settings → Secrets and variables → Actions 配置:

**Secrets**
- `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`(建议用仅对该 bucket 有写权限的 RAM 子账号)

**Variables**
- `OSS_ENDPOINT`(如 `oss-cn-hangzhou.aliyuncs.com`)
- `OSS_BUCKET`(如 `cola-plugins`)
- `OSS_PUBLIC_BASE`(如 `https://cola-plugins.oss-cn-hangzhou.aliyuncs.com` 或 CDN 域名)

`scripts/build-registry.ts` 里的 `DEFAULT_PUBLIC_BASE` 应与 `OSS_PUBLIC_BASE` 一致,
供本地 `pnpm build:registry` 使用。

## 一次性迁移 / 手动重发

在 Actions 里手动运行 `Release` workflow(workflow_dispatch),会忽略版本 diff、
重新构建并上传全部插件,然后刷新 OSS 上的 `registry.json`。

> 注意:CI 构建要求插件 `package.json` 的 SDK 依赖是真实 npm 规格(非 `link:` 本地路径)。
```

- [ ] **Step 2: Commit**

```bash
git add docs/store-oss.md
git commit -m "docs: 插件 store OSS 配置与前端契约"
```

---

## 验证与交付说明

- **可在本环境完全验证的**:Task 1(`pnpm test` + `pnpm build:registry` 输出 OSS 链接)、各 workflow 任务的 YAML 合法性与 `grep` 断言。
- **需真实 OSS 凭据 + 一次真实运行才能端到端验证的**:ossutil 上传、`registry.json` 上 OSS、`ossutil stat` 跳过逻辑。这一步还依赖用户先把插件 SDK 依赖切成真实 npm 规格(见外部前提)。完成代码后,由用户配置好 Secrets/Variables 并手动触发一次 `workflow_dispatch` 做迁移验证。

## 范围之外(本计划不做,见 spec)

- 第三方 PR 在 CI 跑 `npm install` 执行任意脚本的供应链加固。
- 私有 bucket / 签名 URL。
- 多版本并存与按 SDK 版本兼容选版。
