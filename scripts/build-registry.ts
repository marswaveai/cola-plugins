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
  downloadUrl: string
}

const entries: RegistryEntry[] = []

for (const name of fs.readdirSync(pluginsDir)) {
  const dir = path.join(pluginsDir, name)
  if (!fs.statSync(dir).isDirectory()) continue

  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) continue
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

  const mod = await import(dir)
  const plugin = mod.default ?? mod
  if (!plugin?.id || !plugin?.meta) continue

  entries.push({
    id: plugin.id,
    label: plugin.meta.label ?? plugin.id,
    description: plugin.meta.description,
    version: pkg.version,
    minSdkVersion: plugin.minSdkVersion,
    downloadUrl: `https://github.com/marswaveai/cola-plugins/releases/download/${plugin.id}@${pkg.version}/${plugin.id}-${pkg.version}.tar.gz`,
  })
}

const registry = { version: 1, plugins: entries }
const outPath = path.resolve(__dirname, '..', 'registry.json')
fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
console.log(`Wrote registry.json with ${entries.length} plugin(s)`)
