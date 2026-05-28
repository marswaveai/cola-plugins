import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

// 下载与 manifest 的公开根 URL(colaos OSS bucket 的 CDN 域名)。
// 可用 OSS_PUBLIC_BASE 环境变量覆盖(本地/staging)。
const DEFAULT_PUBLIC_BASE = 'https://files.colaos.ai'

export type RegistryEntry = {
  id: string
  label: string
  description?: string
  version: string
  minSdkVersion?: string
  aliases?: string[]
  docsPath?: string
  iconUrl?: string
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
  const iconUrl = normalizeString(channel?.iconUrl)
  const base = publicBase.replace(/\/+$/, '')

  return {
    id,
    label,
    ...(description ? { description } : {}),
    version,
    ...(minSdkVersion ? { minSdkVersion } : {}),
    ...(aliases ? { aliases } : {}),
    ...(docsPath ? { docsPath } : {}),
    ...(iconUrl ? { iconUrl } : {}),
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
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const pluginsDir = path.resolve(moduleDir, '..', 'plugins')
  const publicBase = process.env.OSS_PUBLIC_BASE || DEFAULT_PUBLIC_BASE
  const registry = buildRegistry(pluginsDir, publicBase)
  const outPath = path.resolve(moduleDir, '..', 'registry.json')
  fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
  console.log(`Wrote registry.json with ${registry.plugins.length} plugin(s)`)
}
