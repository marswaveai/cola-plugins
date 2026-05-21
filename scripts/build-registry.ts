import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginsDir = path.resolve(__dirname, '..', 'plugins')

type RegistryEntry = {
  id: string
  label: string
  description?: string
  version: string
  minSdkVersion?: string
  aliases?: string[]
  docsPath?: string
  downloadUrl: string
}

const entries: RegistryEntry[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry))
  return entries.length > 0 ? entries : undefined
}

for (const name of fs.readdirSync(pluginsDir)) {
  const dir = path.join(pluginsDir, name)
  if (!fs.statSync(dir).isDirectory()) continue

  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) continue
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

  const cola = isRecord(pkg.cola) ? pkg.cola : undefined
  const plugin = isRecord(cola?.plugin) ? cola.plugin : undefined
  const channel = isRecord(cola?.channel) ? cola.channel : undefined
  const id = normalizeString(plugin?.id)
  const entry = normalizeString(plugin?.entry)
  const version = normalizeString(pkg.version)
  if (!id || !entry || !version) continue

  const label = normalizeString(channel?.label) ?? id
  const description = normalizeString(channel?.description) ?? normalizeString(pkg.description)
  const minSdkVersion = normalizeString(plugin?.minSdkVersion)
  const aliases = normalizeStringList(channel?.aliases)
  const docsPath = normalizeString(channel?.docsPath)

  entries.push({
    id,
    label,
    ...(description ? { description } : {}),
    version,
    ...(minSdkVersion ? { minSdkVersion } : {}),
    ...(aliases ? { aliases } : {}),
    ...(docsPath ? { docsPath } : {}),
    downloadUrl: `https://github.com/marswaveai/cola-plugins/releases/download/${id}@${version}/${id}-${version}.tar.gz`,
  })
}

const registry = { version: 1, plugins: entries }
const outPath = path.resolve(__dirname, '..', 'registry.json')
fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
console.log(`Wrote registry.json with ${entries.length} plugin(s)`)
